"""Logique métier des courses. Toute transition de statut passe par `transition()` (section 7.2)."""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.common.exceptions import ApiError, Conflict, Forbidden, Locked, NotFound, Unprocessable
from apps.common.geo import coords_to_line, haversine_m, line_to_coords, point
from apps.common.money import ZERO, d, round_franc
from apps.common.push import send_push
from apps.common.sms import send_sms
from apps.geo import routing
from apps.geo.models import QUOTE_ONLY_CATEGORIES, PricingRule, VehicleCategory, Zone
from apps.geo.pricing import commission_for, compute_price, estimate_range
from apps.payments import services as payments
from apps.payments.models import PaymentMethod
from apps.realtime import events

from .models import (
    ACTIVE_STATUSES,
    TRANSITIONS,
    ChatMessage,
    Dispute,
    DisputeStatus,
    OfferResponse,
    Ride,
    RideEvent,
    RideOffer,
    RidePosition,
    RideRating,
    RideStatus,
    TripShare,
)

log = logging.getLogger("vtc242.rides")

CATEGORY_LABELS = dict(VehicleCategory.choices)
CHAT_PRESETS = {
    "arriving": "J'arrive dans 2 minutes",
    "waiting": "Je vous attends au point de prise en charge",
    "where": "Où êtes-vous exactement ?",
    "coming": "J'arrive",
    "traffic": "Il y a des embouteillages, je serai en retard",
    "ok": "D'accord",
}


# --- utilitaires ---------------------------------------------------------------------
def _serialize_for(ride: Ride, role: str) -> dict:
    from .serializers import RideSerializer

    return RideSerializer(ride, context={"role": role}).data


def broadcast_status(ride: Ride) -> None:
    """ride.status_updated vers passager et chauffeur, chacun avec sa vue (section 7.3)."""
    events.send_to_user(ride.passenger_id, "ride.status_updated", _serialize_for(ride, "passenger"))
    if ride.driver is not None:
        events.send_to_user(
            ride.driver.user_id, "ride.status_updated", _serialize_for(ride, "driver")
        )


def log_event(ride: Ride, event_type: str, actor=None, payload: dict | None = None) -> RideEvent:
    return RideEvent.objects.create(
        ride=ride, event_type=event_type, actor=actor, payload=payload or {}
    )


def transition(ride: Ride, new_status: str, actor=None, payload: dict | None = None) -> Ride:
    allowed = TRANSITIONS.get(ride.status, ())
    if new_status not in allowed:
        raise Conflict(
            f"Transition interdite : {ride.status} → {new_status}.",
            code="invalid_transition",
            details={"from": ride.status, "to": new_status},
        )
    old = ride.status
    ride.status = new_status
    now = timezone.now()
    stamp_map: dict[str, str] = {
        RideStatus.DISPATCHING: "dispatch_started_at",
        RideStatus.ACCEPTED: "accepted_at",
        RideStatus.ARRIVED: "arrived_at",
        RideStatus.IN_PROGRESS: "started_at",
        RideStatus.COMPLETED: "completed_at",
        RideStatus.CANCELLED_BY_PASSENGER: "cancelled_at",
        RideStatus.CANCELLED_BY_DRIVER: "cancelled_at",
        RideStatus.NO_DRIVER: "cancelled_at",
    }
    stamp = stamp_map.get(new_status)
    if stamp:
        setattr(ride, stamp, now)
    ride.save()
    log_event(ride, f"status.{new_status}", actor, {"from": old, **(payload or {})})
    return ride


def get_ride_for(user, ride_id) -> Ride:
    """404 pour une course d'autrui (A-18)."""
    qs = Ride.objects.select_related(
        "driver__user", "driver__active_vehicle", "vehicle", "passenger", "zone", "pricing_rule"
    )
    ride = qs.filter(pk=ride_id).first()
    if ride is None:
        raise NotFound("Course introuvable.")
    if user.role == "passenger" and ride.passenger_id != user.id:
        raise NotFound("Course introuvable.")
    if user.role == "driver":
        driver = getattr(user, "driver", None)
        if driver is None or ride.driver_id != driver.id:
            # un chauffeur peut consulter une course qui lui est proposée
            if not RideOffer.objects.filter(
                ride=ride, driver=driver, response__isnull=True
            ).exists():
                raise NotFound("Course introuvable.")
    return ride


def _locked_ride(ride_id) -> Ride:
    return (
        Ride.objects.select_for_update(of=("self",))
        .select_related(
            "driver__user", "driver__active_vehicle", "vehicle", "passenger", "zone", "pricing_rule"
        )
        .get(pk=ride_id)
    )


def active_ride_for_passenger(user) -> Ride | None:
    return (
        Ride.objects.filter(passenger=user, status__in=ACTIVE_STATUSES)
        .select_related("driver__user")
        .first()
    )


def active_ride_for_driver(driver) -> Ride | None:
    return (
        Ride.objects.filter(driver=driver, status__in=ACTIVE_STATUSES)
        .select_related("passenger")
        .first()
    )


# --- estimation (F-13) -----------------------------------------------------------------
def estimate(pickup: dict, dropoff: dict) -> dict:
    from apps.drivers import geoindex

    p_point = point(pickup["lat"], pickup["lng"])
    zone = Zone.resolve(p_point)
    if zone is None:
        raise Unprocessable("Point de départ hors de la zone de service.", code="out_of_zone")
    if Zone.resolve(point(dropoff["lat"], dropoff["lng"])) is None:
        raise Unprocessable("Destination hors de la zone de service.", code="out_of_zone")
    r = routing.route(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    estimates = []
    for category in VehicleCategory.values:
        rule = PricingRule.active_for(zone, category)
        if rule is None:
            continue
        low, high = estimate_range(rule, r.distance_m, r.duration_s)
        nearby = geoindex.nearby(
            category, pickup["lat"], pickup["lng"], settings.DISPATCH_RADII_M[-1], count=10
        )
        eta = None
        if nearby:
            from apps.drivers.models import Driver

            first = Driver.objects.filter(pk=nearby[0][0]).first()
            if first and first.current_location:
                eta = routing.eta_seconds(
                    first.current_location.y, first.current_location.x, pickup["lat"], pickup["lng"]
                )
        estimates.append(
            {
                "category": category,
                "label": CATEGORY_LABELS[category],
                "price_min": str(low),
                "price_max": str(high),
                "pricing_rule_id": str(rule.id),
                "cash_enabled": bool(zone.cash_enabled and rule.cash_enabled),
                "eta_pickup_s": eta,
                "available_drivers": len(nearby),
                "on_quote": category in QUOTE_ONLY_CATEGORIES,
            }
        )
    from apps.geo.serializers import ZoneSerializer

    return {
        "zone": ZoneSerializer(zone).data,
        "distance_m": r.distance_m,
        "duration_s": r.duration_s,
        "route": r.coords,
        "estimates": estimates,
    }


# --- création (F-15) --------------------------------------------------------------------
@transaction.atomic
def create_ride(passenger, data: dict) -> Ride:
    if passenger.role != "passenger":
        raise Forbidden("Seul un passager peut commander.")
    if active_ride_for_passenger(passenger):
        raise Conflict("Vous avez déjà une course en cours.", code="ride_already_active")
    pickup, dropoff = data["pickup"], data["dropoff"]
    p_point, d_point = point(pickup["lat"], pickup["lng"]), point(dropoff["lat"], dropoff["lng"])
    zone = Zone.resolve(p_point)
    if zone is None or Zone.resolve(d_point) is None:
        raise Unprocessable("Adresse hors de la zone de service.", code="out_of_zone")
    category = data["category"]
    if category in QUOTE_ONLY_CATEGORIES:
        raise Unprocessable(
            "Cette catégorie est sur devis : contactez le support.", code="quote_only"
        )
    rule = PricingRule.objects.filter(
        pk=data["pricing_rule_id"], zone=zone, category=category
    ).first()
    current = PricingRule.active_for(zone, category)
    if rule is None or current is None or rule.id != current.id:
        raise Unprocessable(
            "La grille tarifaire a changé, relancez l'estimation.", code="pricing_changed"
        )
    r = routing.route(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    low, high = estimate_range(rule, r.distance_m, r.duration_s)
    method = data.get("payment_method", PaymentMethod.WALLET)
    if method == PaymentMethod.CASH and not (zone.cash_enabled and rule.cash_enabled):
        raise Unprocessable(
            "Le paiement en espèces n'est pas disponible ici.", code="cash_disabled"
        )
    code = "".join(secrets.choice("0123456789") for _ in range(4))
    ride = Ride(
        passenger=passenger,
        category=category,
        payment_method=method,
        pricing_rule=rule,
        zone=zone,
        otp_code_hash=make_password(code),
        otp_code_plain=code,
        pickup_location=p_point,
        dropoff_location=d_point,
        pickup_address=pickup["address"],
        dropoff_address=dropoff["address"],
        planned_route=coords_to_line(r.coords),
        planned_distance_m=r.distance_m,
        planned_duration_s=r.duration_s,
        estimated_price_min=low,
        estimated_price_max=high,
    )
    if method == PaymentMethod.WALLET:
        payments.reserve(passenger, high)
        ride.reserved_amount = high
    try:
        ride.save()
    except IntegrityError:
        raise Conflict("Vous avez déjà une course en cours.", code="ride_already_active")
    log_event(ride, "ride.requested", passenger, {"category": category, "payment_method": method})
    transition(ride, RideStatus.DISPATCHING, passenger)
    from .tasks import dispatch_ride

    transaction.on_commit(lambda: dispatch_ride.delay(str(ride.id)))
    transaction.on_commit(lambda: broadcast_status(ride))
    return ride


# --- dispatch : acceptation / refus (F-33) -----------------------------------------------
@transaction.atomic
def accept(ride_id, driver) -> Ride:
    from apps.drivers import services as driver_services
    from apps.drivers.models import Driver

    ride = _locked_ride(ride_id)
    driver = (
        Driver.objects.select_for_update(of=("self",))
        .select_related("user", "active_vehicle")
        .get(pk=driver.pk)
    )
    offer = (
        RideOffer.objects.filter(ride=ride, driver=driver, response__isnull=True)
        .order_by("-offered_at")
        .first()
    )
    if ride.status != RideStatus.DISPATCHING or ride.driver_id:
        raise Conflict("Course déjà attribuée.", code="ride_taken")
    if offer is None or offer.expires_at < timezone.now():
        raise Conflict("Offre expirée.", code="offer_expired")
    if not driver.is_online or driver.active_vehicle is None:
        raise Conflict(
            "Vous devez être en ligne avec un véhicule actif.", code="driver_unavailable"
        )
    offer.response = OfferResponse.ACCEPTED
    offer.responded_at = timezone.now()
    offer.save(update_fields=["response", "responded_at"])
    ride.driver = driver
    ride.vehicle = driver.active_vehicle
    transition(ride, RideStatus.ACCEPTED, driver.user, {"offer_id": str(offer.id)})
    driver_services.reset_declines(driver)
    driver_services.set_availability(driver, False)
    cache.delete(f"ride:lock:{ride.id}")
    v = driver.active_vehicle
    sms = (
        f"VTC 242 : {driver.user.first_name} arrive en {v.brand} {v.model} {v.color} "
        f"({v.license_plate}). "
        f"Votre code de départ : {ride.otp_code_plain}."
    )
    if settings.RIDE_SMS_ENABLED:
        transaction.on_commit(lambda: send_sms(ride.passenger.phone_number, sms))
    transaction.on_commit(
        lambda: send_push(
            ride.passenger,
            "Chauffeur trouvé",
            f"{driver.user.first_name} arrive. Code : {ride.otp_code_plain}",
            {"ride_id": str(ride.id)},
        )
    )
    transaction.on_commit(lambda: broadcast_status(ride))
    from . import dispatch

    transaction.on_commit(lambda: dispatch.redispatch_waiting(ride.id))
    return ride


@transaction.atomic
def decline(ride_id, driver) -> None:
    from apps.drivers import services as driver_services

    ride = _locked_ride(ride_id)
    offer = RideOffer.objects.filter(ride=ride, driver=driver, response__isnull=True).first()
    if offer is None:
        return
    offer.response = OfferResponse.DECLINED
    offer.responded_at = timezone.now()
    offer.save(update_fields=["response", "responded_at"])
    log_event(ride, "offer.declined", driver.user, {"driver_id": str(driver.id)})
    driver_services.register_decline(driver)
    cache.delete(f"ride:lock:{ride.id}")
    from . import dispatch
    from .tasks import dispatch_ride

    transaction.on_commit(lambda: dispatch_ride.delay(str(ride.id)))
    transaction.on_commit(lambda: dispatch.redispatch_waiting(ride.id))


@transaction.atomic
def no_driver(ride_id) -> Ride | None:
    ride = _locked_ride(ride_id)
    if ride.status not in (RideStatus.REQUESTED, RideStatus.DISPATCHING):
        return ride
    if ride.payment_method == PaymentMethod.WALLET and ride.reserved_amount:
        payments.release(ride.passenger, ride.reserved_amount)
    transition(ride, RideStatus.NO_DRIVER, None, {"offers": ride.offers_count})
    transaction.on_commit(lambda: broadcast_status(ride))
    transaction.on_commit(
        lambda: send_push(
            ride.passenger, "Aucun chauffeur disponible", "Réessayez dans quelques minutes."
        )
    )
    return ride


# --- approche, arrivée, code, course (F-36, F-37) ----------------------------------------
def _check_driver(ride: Ride, driver) -> None:
    if ride.driver_id != driver.id:
        raise NotFound("Course introuvable.")


def _distance_to(ride_point, lat: float, lng: float) -> float:
    return haversine_m(lat, lng, ride_point.y, ride_point.x)


@transaction.atomic
def arrive(ride_id, driver, lat: float, lng: float) -> Ride:
    ride = _locked_ride(ride_id)
    _check_driver(ride, driver)
    if ride.status != RideStatus.ACCEPTED:
        raise Conflict("La course n'est pas en approche.", code="invalid_transition")
    dist = _distance_to(ride.pickup_location, lat, lng)
    if dist > settings.RIDE_PROXIMITY_RADIUS_M:
        raise Unprocessable(
            "Vous êtes trop loin du point de prise en charge.",
            code="too_far",
            details={"distance_m": int(dist)},
        )
    transition(ride, RideStatus.ARRIVED, driver.user, {"distance_m": int(dist)})
    transaction.on_commit(lambda: broadcast_status(ride))
    transaction.on_commit(
        lambda: send_push(
            ride.passenger, "Votre chauffeur est arrivé", "Donnez-lui votre code de départ."
        )
    )
    return ride


def _verify_start_code(ride_id, driver, otp_code: str) -> None:
    """Vérifie le code de départ dans sa propre transaction : tentatives, verrouillage et
    alerte sont persistés même quand une erreur est renvoyée (F-37)."""
    from apps.safety import services as safety

    error: ApiError | None = None
    with transaction.atomic():
        ride = _locked_ride(ride_id)
        _check_driver(ride, driver)
        if ride.status != RideStatus.ARRIVED:
            raise Conflict("Signalez d'abord votre arrivée.", code="invalid_transition")
        if ride.otp_locked_at:
            raise Locked(
                "Course verrouillée après 3 codes erronés. Le support a été alerté.",
                code="ride_locked",
            )
        if not check_password(otp_code, ride.otp_code_hash):
            ride.otp_attempts += 1
            payload = {"attempts": ride.otp_attempts}
            if ride.otp_attempts >= settings.RIDE_OTP_MAX_ATTEMPTS:
                ride.otp_locked_at = timezone.now()
                ride.save(update_fields=["otp_attempts", "otp_locked_at"])
                log_event(ride, "otp.locked", driver.user, payload)
                safety.raise_alert("otp_locked", ride, payload)
                error = Locked(
                    "Course verrouillée après 3 codes erronés. Le support a été alerté.",
                    code="ride_locked",
                )
            else:
                ride.save(update_fields=["otp_attempts"])
                log_event(ride, "otp.failed", driver.user, payload)
                error = ApiError(
                    "Code de départ invalide.",
                    code="invalid_otp",
                    details={"attempts_left": settings.RIDE_OTP_MAX_ATTEMPTS - ride.otp_attempts},
                )
    if error is not None:
        raise error


def start(
    ride_id, driver, otp_code: str, lat: float | None = None, lng: float | None = None
) -> Ride:
    _verify_start_code(ride_id, driver, otp_code)
    with transaction.atomic():
        return _start_verified(ride_id, driver, lat, lng)


def _start_verified(ride_id, driver, lat: float | None, lng: float | None) -> Ride:
    from apps.safety import services as safety

    ride = _locked_ride(ride_id)
    if ride.status != RideStatus.ARRIVED:
        raise Conflict("Signalez d'abord votre arrivée.", code="invalid_transition")
    now = timezone.now()
    ride.otp_verified_at = now
    if ride.arrived_at:
        ride.waiting_seconds = int((now - ride.arrived_at).total_seconds())
    # itinéraire planifié figé au départ (section 7.5)
    origin_lat, origin_lng = (
        (lat, lng)
        if lat is not None and lng is not None
        else (ride.pickup_location.y, ride.pickup_location.x)
    )
    r = routing.route(origin_lat, origin_lng, ride.dropoff_location.y, ride.dropoff_location.x)
    ride.planned_route = coords_to_line(r.coords)
    ride.planned_distance_m = r.distance_m
    ride.planned_duration_s = r.duration_s
    transition(ride, RideStatus.IN_PROGRESS, driver.user, {"waiting_seconds": ride.waiting_seconds})
    safety.index_route(ride)
    transaction.on_commit(lambda: broadcast_status(ride))
    return ride


@transaction.atomic
def report_detour(ride_id, driver, reason: str) -> Ride:
    from apps.safety import services as safety

    ride = _locked_ride(ride_id)
    _check_driver(ride, driver)
    if ride.status != RideStatus.IN_PROGRESS:
        raise Conflict("La course n'est pas en cours.", code="invalid_transition")
    ride.detour_until = timezone.now() + timedelta(seconds=settings.DETOUR_GRACE_S)
    ride.save(update_fields=["detour_until"])
    log_event(ride, "detour.reported", driver.user, {"reason": reason})
    safety.clear_deviation(ride, reason="detour")
    safety.raise_alert("detour", ride, {"reason": reason})
    events.send_to_user(
        ride.passenger_id,
        "ride.detour",
        {"ride_id": str(ride.id), "reason": reason, "until": ride.detour_until.isoformat()},
    )
    transaction.on_commit(lambda: broadcast_status(ride))
    return ride


@transaction.atomic
def confirm_arrival(ride_id, passenger) -> Ride:
    ride = _locked_ride(ride_id)
    if ride.passenger_id != passenger.id:
        raise NotFound("Course introuvable.")
    if ride.status != RideStatus.IN_PROGRESS:
        raise Conflict("La course n'est pas en cours.", code="invalid_transition")
    ride.passenger_confirmed_arrival_at = timezone.now()
    ride.save(update_fields=["passenger_confirmed_arrival_at"])
    log_event(ride, "arrival.confirmed_by_passenger", passenger)
    if ride.driver is not None:
        events.send_to_user(
            ride.driver.user_id, "ride.arrival_confirmed", {"ride_id": str(ride.id)}
        )
    return ride


def _actual_distance_m(ride: Ride) -> tuple[int, list[list[float]]]:
    coords = [
        [p.location.x, p.location.y]
        for p in ride.positions.filter(recorded_at__gte=ride.started_at or ride.requested_at)
    ]
    if len(coords) < 2:
        return ride.planned_distance_m or 0, coords
    total = 0.0
    for (lng1, lat1), (lng2, lat2) in zip(coords, coords[1:], strict=False):
        total += haversine_m(lat1, lng1, lat2, lng2)
    return int(total), coords


@transaction.atomic
def complete(ride_id, driver, lat: float | None, lng: float | None) -> Ride:
    from apps.drivers import services as driver_services
    from apps.safety import services as safety

    ride = _locked_ride(ride_id)
    _check_driver(ride, driver)
    if ride.status != RideStatus.IN_PROGRESS:
        raise Conflict("La course n'est pas en cours.", code="invalid_transition")
    if ride.passenger_confirmed_arrival_at is None:
        if lat is None or lng is None:
            raise Unprocessable("Position requise pour clôturer.", code="position_required")
        dist = _distance_to(ride.dropoff_location, lat, lng)
        if dist > settings.RIDE_PROXIMITY_RADIUS_M:
            raise Unprocessable(
                "Vous êtes à plus de 200 m de la destination. Demandez la validation du passager.",
                code="too_far",
                details={"distance_m": int(dist)},
            )
    now = timezone.now()
    ride.ride_seconds = int((now - (ride.started_at or now)).total_seconds())
    actual_m, coords = _actual_distance_m(ride)
    # distance facturée : réel si crédible, sinon planifié (GPS d'entrée de gamme, N-05)
    planned = ride.planned_distance_m or 0
    billed_m = actual_m if planned == 0 or 0.5 * planned <= actual_m <= 2.0 * planned else planned
    ride.actual_distance_m = actual_m
    ride.actual_route = coords_to_line(coords)
    rule = ride.pricing_rule
    breakdown = compute_price(rule, billed_m, ride.ride_seconds, ride.waiting_seconds)
    final_price = breakdown.price
    commission = commission_for(rule, final_price)
    result = payments.settle_ride(ride, final_price, commission)
    ride.final_price = final_price
    ride.commission_amount = commission
    ride.driver_earning = result["earning"]
    ride.price_capped = result["capped"]
    ride.dispute_deadline_at = now + timedelta(hours=settings.RIDE_DISPUTE_WINDOW_HOURS)
    transition(
        ride,
        RideStatus.COMPLETED,
        driver.user,
        {
            "final_price": str(final_price),
            "commission": str(commission),
            "billed_m": billed_m,
            "breakdown": breakdown.as_dict(),
        },
    )
    if result["capped"]:
        safety.raise_alert(
            "price_capped",
            ride,
            {"final_price": str(final_price), "charged": str(result["charged"])},
        )
    safety.clear_route(ride)
    driver_services.set_availability(driver, True)
    transaction.on_commit(lambda: broadcast_status(ride))
    transaction.on_commit(
        lambda: send_push(
            ride.passenger,
            "Course terminée",
            f"Prix : {final_price:.0f} F. Merci !",
            {"ride_id": str(ride.id)},
        )
    )
    return ride


# --- annulation (F-15, F-22, section 8.4) ------------------------------------------------
def cancellation_fee_preview(ride: Ride, by_role: str) -> Decimal:
    if by_role != "passenger" or ride.status not in (RideStatus.ACCEPTED, RideStatus.ARRIVED):
        return ZERO
    return d(ride.pricing_rule.cancellation_fee)


@transaction.atomic
def cancel(ride_id, actor, reason: str) -> Ride:
    from apps.drivers import services as driver_services
    from apps.safety import services as safety

    ride = _locked_ride(ride_id)
    if actor.role == "passenger":
        if ride.passenger_id != actor.id:
            raise NotFound("Course introuvable.")
        target = RideStatus.CANCELLED_BY_PASSENGER
    elif actor.role == "driver":
        _check_driver(ride, actor.driver)
        target = RideStatus.CANCELLED_BY_DRIVER
    else:
        target = RideStatus.CANCELLED_BY_PASSENGER
    if target not in TRANSITIONS.get(ride.status, ()):
        raise Conflict("Cette course ne peut plus être annulée.", code="invalid_transition")
    fee = cancellation_fee_preview(ride, actor.role)
    charged = ZERO
    if ride.payment_method == PaymentMethod.WALLET:
        if fee > ZERO and ride.driver_id:
            charged = payments.charge_cancellation(
                ride, fee, ride.pricing_rule.driver_cancellation_share
            )
        elif ride.reserved_amount:
            payments.release(ride.passenger, ride.reserved_amount)
    ride.cancellation_fee = charged
    ride.cancel_reason = reason
    prior_driver = ride.driver
    transition(ride, target, actor, {"reason": reason, "fee": str(charged)})
    cache.delete(f"ride:lock:{ride.id}")
    RideOffer.objects.filter(ride=ride, response__isnull=True).update(
        response=OfferResponse.TIMEOUT, responded_at=timezone.now()
    )
    safety.clear_route(ride)
    if prior_driver:
        driver_services.set_availability(prior_driver, True)
        other_id = ride.passenger_id if actor.role == "driver" else prior_driver.user_id
        events.send_to_user(
            other_id,
            "ride.cancelled",
            {"ride_id": str(ride.id), "by": actor.role, "reason": reason, "fee": str(charged)},
        )
    transaction.on_commit(lambda: broadcast_status(ride))
    return ride


# --- notation, litige, chat, partage, urgence -------------------------------------------
@transaction.atomic
def rate(ride_id, rater, score: int, comment: str = "") -> RideRating:
    ride = get_ride_for(rater, ride_id)
    if ride.status != RideStatus.COMPLETED:
        raise Conflict("Seule une course terminée peut être notée.", code="invalid_state")
    if not 1 <= score <= 5:
        raise ApiError("Note entre 1 et 5.", code="validation_error")
    if ride.driver is None:
        raise Conflict("Course sans chauffeur.", code="invalid_state")
    ratee = ride.driver.user if rater.id == ride.passenger_id else ride.passenger
    if RideRating.objects.filter(ride=ride, rater=rater).exists():
        raise Conflict("Vous avez déjà noté cette course.", code="already_rated")
    rating = RideRating.objects.create(
        ride=ride, rater=rater, ratee=ratee, score=score, comment=comment or ""
    )
    # moyenne glissante
    from django.db.models import Avg, Count

    agg = RideRating.objects.filter(ratee=ratee).aggregate(avg=Avg("score"), n=Count("id"))
    ratee.rating_avg = round(Decimal(str(agg["avg"] or 5)), 2)
    ratee.rating_count = agg["n"]
    ratee.save(update_fields=["rating_avg", "rating_count"])
    if ratee.role == "driver" and hasattr(ratee, "driver"):
        ratee.driver.rating_avg = ratee.rating_avg
        ratee.driver.rating_count = ratee.rating_count
        ratee.driver.save(update_fields=["rating_avg", "rating_count"])
    log_event(ride, "rated", rater, {"score": score})
    return rating


@transaction.atomic
def open_dispute(ride_id, passenger, reason: str) -> Dispute:
    ride = get_ride_for(passenger, ride_id)
    if ride.passenger_id != passenger.id or ride.status != RideStatus.COMPLETED:
        raise Conflict("Seule une course terminée peut être contestée.", code="invalid_state")
    if ride.dispute_deadline_at and timezone.now() > ride.dispute_deadline_at:
        raise Conflict(
            "Le délai de contestation de 24 h est dépassé.", code="dispute_window_closed"
        )
    if Dispute.objects.filter(ride=ride).exists():
        raise Conflict("Un litige existe déjà pour cette course.", code="already_disputed")
    dispute = Dispute.objects.create(ride=ride, opened_by=passenger, reason=reason)
    log_event(ride, "dispute.opened", passenger, {"reason": reason})
    events.send_to_admins(
        "admin.alert", {"type": "dispute", "ride_id": str(ride.id), "reason": reason}
    )
    return dispute


@transaction.atomic
def resolve_dispute(
    dispute: Dispute, actor, refund_amount: Decimal | None, resolution: str, reject: bool = False
) -> Dispute:
    dispute = (
        Dispute.objects.select_for_update(of=("self",))
        .select_related("ride__passenger", "ride__driver__user")
        .get(pk=dispute.pk)
    )
    if dispute.status != DisputeStatus.OPEN:
        raise Conflict("Litige déjà traité.", code="invalid_state")
    if reject:
        dispute.status = DisputeStatus.REJECTED
    else:
        amount = d(refund_amount or ZERO)
        if amount > ZERO:
            max_refund = d(dispute.ride.final_price or ZERO)
            if amount > max_refund:
                raise Unprocessable(
                    "Le remboursement dépasse le prix de la course.", code="invalid_amount"
                )
            payments.refund(dispute.ride, amount, actor, resolution)
            dispute.refund_amount = amount
        dispute.status = DisputeStatus.RESOLVED
    dispute.resolution = resolution
    dispute.resolved_by = actor
    dispute.resolved_at = timezone.now()
    dispute.save()
    log_event(
        dispute.ride,
        "dispute.resolved",
        actor,
        {"status": dispute.status, "refund": str(dispute.refund_amount or 0)},
    )
    send_push(dispute.ride.passenger, "Litige traité", resolution[:120])
    return dispute


def send_message(
    ride: Ride, sender, body: str | None = None, preset: str | None = None
) -> ChatMessage:
    if preset:
        body = CHAT_PRESETS.get(preset)
        if body is None:
            raise ApiError("Message prédéfini inconnu.", code="validation_error")
    body = (body or "").strip()
    if not body:
        raise ApiError("Message vide.", code="validation_error")
    if len(body) > 500:
        raise ApiError("Message trop long (500 caractères).", code="validation_error")
    role = sender.role if sender.role in ("passenger", "driver") else "support"
    msg = ChatMessage.objects.create(ride=ride, sender=sender, sender_role=role, body=body)
    from .serializers import MessageSerializer

    data = MessageSerializer(msg).data
    events.send_to_user(ride.passenger_id, "chat.message", data)
    if ride.driver is not None:
        events.send_to_user(ride.driver.user_id, "chat.message", data)
    events.send_to_admins("chat.message", data)
    return msg


def create_share(ride: Ride) -> TripShare:
    expires = timezone.now() + timedelta(hours=settings.TRIP_SHARE_EXPIRY_AFTER_END_H + 6)
    share = TripShare.objects.create(ride=ride, token=secrets.token_urlsafe(24), expires_at=expires)
    log_event(ride, "share.created", ride.passenger)
    return share


def share_payload(token: str) -> dict:
    share = (
        TripShare.objects.select_related("ride__driver", "ride__vehicle")
        .filter(token=token)
        .first()
    )
    if share is None or share.expires_at < timezone.now():
        raise NotFound("Lien expiré.", code="share_expired")
    ride = share.ride
    if ride.completed_at and timezone.now() > ride.completed_at + timedelta(
        hours=settings.TRIP_SHARE_EXPIRY_AFTER_END_H
    ):
        raise NotFound("Lien expiré.", code="share_expired")
    drv = ride.driver
    pos = None
    eta = None
    if drv and drv.current_location and ride.is_active:
        lat, lng = float(drv.current_location.y), float(drv.current_location.x)
        pos = {"lat": lat, "lng": lng, "heading": drv.heading}
        target = (
            ride.dropoff_location if ride.status == RideStatus.IN_PROGRESS else ride.pickup_location
        )
        eta = routing.eta_seconds(lat, lng, target.y, target.x)
    v = ride.vehicle
    return {
        "status": ride.status,
        "driver_position": pos,
        "eta_s": eta,
        "pickup": {"lat": ride.pickup_location.y, "lng": ride.pickup_location.x},
        "dropoff": {"lat": ride.dropoff_location.y, "lng": ride.dropoff_location.x},
        "planned_route": line_to_coords(ride.planned_route),
        "vehicle": {
            "brand": v.brand,
            "model": v.model,
            "color": v.color,
            "license_plate": v.license_plate,
        }
        if v
        else None,
        "expires_at": share.expires_at.isoformat(),
    }


# --- positions pendant la course (F-17, F-41) ---------------------------------------------
def record_ride_position(driver, pos: dict) -> None:
    from apps.safety import services as safety

    ride = active_ride_for_driver(driver)
    if ride is None:
        return
    lat, lng = float(pos["lat"]), float(pos["lng"])
    if ride.status == RideStatus.IN_PROGRESS:
        RidePosition.objects.create(
            ride=ride,
            driver=driver,
            location=point(lat, lng),
            speed_kmh=pos.get("speed_kmh"),
            heading=pos.get("heading"),
            accuracy_m=pos.get("accuracy_m"),
            recorded_at=pos["recorded_at"],
        )
    key = f"ride:lastpos:{ride.id}"
    if cache.get(key):
        return  # au plus une diffusion toutes les 3 s
    cache.set(key, 1, timeout=settings.POSITION_BROADCAST_MIN_INTERVAL_S)
    target = (
        ride.dropoff_location if ride.status == RideStatus.IN_PROGRESS else ride.pickup_location
    )
    eta = routing.eta_seconds(lat, lng, target.y, target.x)
    data = {
        "ride_id": str(ride.id),
        "lat": lat,
        "lng": lng,
        "heading": pos.get("heading"),
        "eta_s": eta,
    }
    events.send_to_user(ride.passenger_id, "ride.driver_position", data)
    events.send_to_admins("ride.driver_position", data)
    if ride.status == RideStatus.IN_PROGRESS:
        safety.check_position(ride, lat, lng)


def notify_position_lost(driver) -> None:
    from apps.safety import services as safety

    ride = active_ride_for_driver(driver)
    if ride is None:
        return
    data = {
        "ride_id": str(ride.id),
        "since": driver.last_location_at.isoformat() if driver.last_location_at else None,
    }
    events.send_to_user(ride.passenger_id, "ride.position_lost", data)
    safety.raise_alert("position_lost", ride, data)


def notify_position_restored(driver) -> None:
    ride = active_ride_for_driver(driver)
    if ride is None:
        return
    events.send_to_user(ride.passenger_id, "ride.position_restored", {"ride_id": str(ride.id)})


def driver_earning_estimate(ride: Ride) -> Decimal:
    center = compute_price(
        ride.pricing_rule, ride.planned_distance_m or 0, ride.planned_duration_s or 0
    ).price
    return round_franc(center * (1 - ride.pricing_rule.commission_rate))
