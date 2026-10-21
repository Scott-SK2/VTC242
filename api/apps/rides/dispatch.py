"""Dispatch automatique (section 7.4) : offres successives de 15 s aux chauffeurs
les plus proches."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.drivers import geoindex
from apps.drivers.models import Driver
from apps.geo import routing
from apps.realtime import events

from .models import OfferResponse, Ride, RideOffer, RideStatus

log = logging.getLogger("vtc242.dispatch")


def _candidates(ride: Ride) -> list[tuple[Driver, float]]:
    lat, lng = ride.pickup_location.y, ride.pickup_location.x
    now = timezone.now()
    # Chauffeurs déjà sollicités pendant la série en cours (une relance repart de zéro)
    series = ride.offers.all()
    if ride.dispatch_started_at:
        series = series.filter(offered_at__gte=ride.dispatch_started_at)
    excluded = set(str(x) for x in series.values_list("driver_id", flat=True))
    # Un chauffeur ne reçoit qu'une offre à la fois : ceux qui en ont une en cours sur une
    # autre course sont écartés (ils redeviennent candidats dès qu'elle est tranchée).
    excluded |= set(
        str(x)
        for x in RideOffer.objects.filter(response__isnull=True, expires_at__gt=now)
        .exclude(ride=ride)
        .values_list("driver_id", flat=True)
    )
    min_rating = ride.zone.min_driver_rating
    for radius in settings.DISPATCH_RADII_M:
        rows = geoindex.nearby(ride.category, lat, lng, radius, count=10)
        ids = [rid for rid, _ in rows if rid not in excluded]
        if not ids:
            continue
        dist_by_id = {rid: dist for rid, dist in rows}
        drivers = (
            Driver.objects.filter(
                pk__in=ids,
                is_online=True,
                is_available=True,
                status="approved",
                active_vehicle__category=ride.category,
            )
            .exclude(paused_until__gt=now)
            .filter(rating_avg__gte=min_rating)
            .select_related("user", "active_vehicle")
        )
        scored = []
        for drv in drivers:
            dist = dist_by_id.get(str(drv.id), 0.0)
            eta = (
                routing.eta_seconds(drv.current_location.y, drv.current_location.x, lat, lng)
                if drv.current_location
                else dist / 6
            )
            score = eta * (1 + float(5 - drv.rating_avg) * 0.1)
            scored.append((score, drv, dist))
        if scored:
            scored.sort(key=lambda t: t[0])
            return [(drv, dist) for _, drv, dist in scored]
    return []


def offer_payload(ride: Ride, offer: RideOffer) -> dict:
    return {
        "ride_id": str(ride.id),
        "category": ride.category,
        "pickup": {
            "address": ride.pickup_address,
            "lat": ride.pickup_location.y,
            "lng": ride.pickup_location.x,
            "distance_m": offer.distance_m,
        },
        "dropoff": {
            "address": ride.dropoff_address,
            "lat": ride.dropoff_location.y,
            "lng": ride.dropoff_location.x,
        },
        "estimated_earning": str(offer.estimated_earning),
        "expires_at": offer.expires_at.isoformat(),
        "ttl_s": settings.DISPATCH_OFFER_TTL_S,
        "planned_distance_m": ride.planned_distance_m,
        "planned_duration_s": ride.planned_duration_s,
    }


@transaction.atomic
def offer_next(ride_id) -> RideOffer | None:
    """Propose la course au meilleur chauffeur suivant ; no_driver après 5 offres ou 2 min."""
    from . import services

    ride = (
        Ride.objects.select_for_update(of=("self",))
        .select_related("zone", "pricing_rule")
        .filter(pk=ride_id)
        .first()
    )
    if ride is None or ride.status != RideStatus.DISPATCHING:
        return None
    if RideOffer.objects.filter(
        ride=ride, response__isnull=True, expires_at__gt=timezone.now()
    ).exists():
        return None  # une offre est déjà en cours
    started = ride.dispatch_started_at or ride.requested_at
    if ride.offers_count >= settings.DISPATCH_MAX_OFFERS or timezone.now() - started > timedelta(
        seconds=settings.DISPATCH_MAX_DURATION_S
    ):
        transaction.on_commit(lambda: services.no_driver(ride.id))
        return None
    candidates = _candidates(ride)
    if not candidates:
        # aucun chauffeur : on réessaie via le watchdog jusqu'à 2 min, puis no_driver
        if timezone.now() - started > timedelta(seconds=settings.DISPATCH_MAX_DURATION_S):
            transaction.on_commit(lambda: services.no_driver(ride.id))
        return None
    driver, dist = candidates[0]
    lock_key = f"ride:lock:{ride.id}"
    if not cache.add(lock_key, str(driver.id), timeout=settings.DISPATCH_OFFER_TTL_S):
        return None
    offer = RideOffer.objects.create(
        ride=ride,
        driver=driver,
        expires_at=timezone.now() + timedelta(seconds=settings.DISPATCH_OFFER_TTL_S),
        distance_m=int(dist),
        estimated_earning=services.driver_earning_estimate(ride),
    )
    ride.offers_count += 1
    ride.save(update_fields=["offers_count"])
    services.log_event(
        ride, "offer.sent", None, {"driver_id": str(driver.id), "distance_m": int(dist)}
    )
    payload = offer_payload(ride, offer)
    transaction.on_commit(lambda: events.send_to_user(driver.user_id, "ride.offer", payload))
    from .tasks import expire_offer

    transaction.on_commit(
        lambda: expire_offer.apply_async(
            args=[str(offer.id)], countdown=settings.DISPATCH_OFFER_TTL_S + 1
        )
    )
    return offer


@transaction.atomic
def expire_offer_if_due(offer_id) -> bool:
    offer = (
        RideOffer.objects.select_for_update(of=("self",))
        .select_related("ride")
        .filter(pk=offer_id)
        .first()
    )
    if offer is None or offer.response is not None:
        return False
    if offer.expires_at > timezone.now():
        return False
    offer.response = OfferResponse.TIMEOUT
    offer.responded_at = timezone.now()
    offer.save(update_fields=["response", "responded_at"])
    cache.delete(f"ride:lock:{offer.ride_id}")
    from . import services

    services.log_event(offer.ride, "offer.timeout", None, {"driver_id": str(offer.driver_id)})
    events.send_to_user(offer.driver.user_id, "ride.offer_expired", {"ride_id": str(offer.ride_id)})
    from .tasks import dispatch_ride

    transaction.on_commit(lambda: dispatch_ride.delay(str(offer.ride_id)))
    transaction.on_commit(lambda: redispatch_waiting(offer.ride_id))
    return True


def redispatch_waiting(exclude_ride_id=None) -> int:
    """Relance les courses en recherche sans offre active (un chauffeur vient de se libérer)."""
    from .tasks import dispatch_ride

    now = timezone.now()
    waiting = Ride.objects.filter(status=RideStatus.DISPATCHING).exclude(
        offers__response__isnull=True, offers__expires_at__gt=now
    )
    if exclude_ride_id:
        waiting = waiting.exclude(pk=exclude_ride_id)
    n = 0
    for ride_id in waiting.values_list("id", flat=True).distinct():
        dispatch_ride.delay(str(ride_id))
        n += 1
    return n


def current_offer_for(driver: Driver) -> dict | None:
    offer = (
        RideOffer.objects.filter(
            driver=driver, response__isnull=True, expires_at__gt=timezone.now()
        )
        .select_related("ride")
        .order_by("-offered_at")
        .first()
    )
    if offer is None or offer.ride.status != RideStatus.DISPATCHING:
        return None
    return offer_payload(offer.ride, offer)


def watchdog() -> int:
    """Relance les courses en recherche sans offre active ; clôture celles trop anciennes."""
    from . import services

    n = 0
    now = timezone.now()
    stale = Ride.objects.filter(
        status=RideStatus.NO_DRIVER,
        cancelled_at__lt=now - timedelta(seconds=settings.NO_DRIVER_AUTO_CANCEL_S),
    )
    for ride_id in stale.values_list("id", flat=True):
        services.auto_cancel_no_driver(ride_id)
        n += 1
    for ride in Ride.objects.filter(status=RideStatus.DISPATCHING):
        started = ride.dispatch_started_at or ride.requested_at
        if now - started > timedelta(seconds=settings.DISPATCH_MAX_DURATION_S + 30):
            services.no_driver(ride.id)
            n += 1
            continue
        for offer in RideOffer.objects.filter(ride=ride, response__isnull=True, expires_at__lt=now):
            expire_offer_if_due(offer.id)
        if not RideOffer.objects.filter(
            ride=ride, response__isnull=True, expires_at__gt=now
        ).exists():
            offer_next(ride.id)
            n += 1
    return n


def estimated_earning(ride: Ride) -> Decimal:
    from . import services

    return services.driver_earning_estimate(ride)
