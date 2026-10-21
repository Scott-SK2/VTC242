"""Règles métier du covoiturage."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.exceptions import Conflict, Forbidden, NotFound, Unprocessable
from apps.common.geo import point
from apps.common.money import ZERO, d, round_franc
from apps.common.push import send_push
from apps.drivers.models import Driver, DriverStatus
from apps.payments import services as payments
from apps.realtime import events

from .models import CarpoolBooking, CarpoolBookingStatus, CarpoolTrip, TripStatus

KIND = "carpool"


def trips_queryset():
    return CarpoolTrip.objects.select_related(
        "driver", "driver__driver", "vehicle"
    ).prefetch_related("bookings")


def _broadcast_trip(trip: CarpoolTrip, title: str | None = None, body: str = "") -> None:
    """Diffuse le trajet au conducteur et à tous les passagers confirmés (push si titre)."""
    from .serializers import CarpoolTripSerializer

    trip = trips_queryset().get(pk=trip.pk)
    data = CarpoolTripSerializer(trip).data
    targets = [trip.driver] + [b.passenger for b in _confirmed_bookings(trip)]
    for user in targets:
        events.send_to_user(user.id, "carpool.trip_updated", data)
        if title and user.id != trip.driver_id:
            send_push(user, title, body, {"trip_id": str(trip.id)})


def _approved_driver(user) -> Driver:
    driver = Driver.objects.select_related("active_vehicle").filter(user=user).first()
    if driver is None or driver.status != DriverStatus.APPROVED:
        raise Forbidden(
            "Votre dossier chauffeur doit être validé pour publier un trajet.",
            code="driver_not_approved",
        )
    return driver


@transaction.atomic
def publish_trip(user, data: dict) -> CarpoolTrip:
    driver = _approved_driver(user)
    if data["seats_total"] > settings.CARPOOL_MAX_SEATS:
        raise Unprocessable("Trop de places.", code="validation_error")
    o, dst = data["origin"], data["destination"]
    trip = CarpoolTrip.objects.create(
        driver=user,
        vehicle=driver.active_vehicle,
        origin_address=o["address"],
        origin_location=point(o["lat"], o["lng"]),
        destination_address=dst["address"],
        destination_location=point(dst["lat"], dst["lng"]),
        departure_at=data["departure_at"],
        seats_total=data["seats_total"],
        price_per_seat=round_franc(d(data["price_per_seat"])),
        description=data.get("description", ""),
    )
    return trip


def _locked_trip(trip_id) -> CarpoolTrip:
    trip = (
        CarpoolTrip.objects.select_for_update(of=("self",))
        .select_related("driver")
        .filter(pk=trip_id)
        .first()
    )
    if trip is None:
        raise NotFound("Trajet introuvable.")
    return trip


def _confirmed_bookings(trip: CarpoolTrip):
    return CarpoolBooking.objects.filter(
        trip=trip, status=CarpoolBookingStatus.CONFIRMED
    ).select_related("passenger")


@transaction.atomic
def book(trip_id, passenger, seats: int = 1) -> CarpoolBooking:
    trip = _locked_trip(trip_id)
    if trip.status != TripStatus.PUBLISHED or trip.departure_at <= timezone.now():
        raise Conflict("Ce trajet n'est plus ouvert aux réservations.", code="trip_closed")
    if trip.driver_id == passenger.id:
        raise Conflict("Vous êtes le conducteur de ce trajet.", code="own_trip")
    if _confirmed_bookings(trip).filter(passenger=passenger).exists():
        raise Conflict("Vous avez déjà réservé ce trajet.", code="duplicate")
    booked = sum(b.seats for b in _confirmed_bookings(trip))
    if seats > trip.seats_total - booked:
        raise Conflict(
            "Plus assez de places disponibles.",
            code="no_seats",
            details={"seats_available": trip.seats_total - booked},
        )
    total = round_franc(d(trip.price_per_seat) * seats)
    if total > ZERO:
        payments.reserve(passenger, total, what="ce covoiturage")
    booking = CarpoolBooking.objects.create(
        trip=trip, passenger=passenger, seats=seats, price_total=total
    )
    transaction.on_commit(
        lambda: send_push(
            trip.driver,
            "Nouvelle réservation covoiturage",
            f"{passenger.first_name or 'Un passager'} a réservé {seats} place(s) "
            f"pour {trip.destination_address}.",
            {"trip_id": str(trip.id)},
        )
    )
    transaction.on_commit(lambda: _broadcast_trip(trip))
    return booking


def _release_booking(booking: CarpoolBooking) -> None:
    if booking.price_total > ZERO:
        payments.release(booking.passenger, booking.price_total)


@transaction.atomic
def passenger_cancel(booking_id, passenger, reason: str = "") -> CarpoolBooking:
    booking = (
        CarpoolBooking.objects.select_for_update(of=("self",))
        .select_related("trip", "trip__driver", "passenger")
        .filter(pk=booking_id, passenger=passenger)
        .first()
    )
    if booking is None:
        raise NotFound("Réservation introuvable.")
    if booking.status != CarpoolBookingStatus.CONFIRMED:
        raise Conflict("Cette réservation ne peut plus être annulée.", code="invalid_transition")
    trip = _locked_trip(booking.trip_id)
    if trip.status != TripStatus.PUBLISHED:
        raise Conflict("Le trajet a déjà démarré.", code="invalid_transition")
    fee = cancellation_preview(booking)
    if fee > ZERO:
        fee = payments.charge_service_cancellation(
            booking.passenger,
            trip.driver,
            booking.price_total,
            fee,
            kind=KIND,
            reference=str(booking.id),
        )
    else:
        _release_booking(booking)
    booking.status = CarpoolBookingStatus.CANCELLED_BY_PASSENGER
    booking.cancellation_fee = fee
    booking.status_reason = reason or None
    booking.cancelled_at = timezone.now()
    booking.save(
        update_fields=["status", "cancellation_fee", "status_reason", "cancelled_at", "updated_at"]
    )
    transaction.on_commit(
        lambda: send_push(
            trip.driver,
            "Réservation annulée",
            f"{passenger.first_name or 'Un passager'} a libéré {booking.seats} place(s).",
            {"trip_id": str(trip.id)},
        )
    )
    transaction.on_commit(lambda: _broadcast_trip(trip))
    return booking


def cancellation_preview(booking: CarpoolBooking) -> Decimal:
    if booking.status != CarpoolBookingStatus.CONFIRMED:
        return ZERO
    limit = booking.trip.departure_at - timedelta(hours=settings.CARPOOL_FREE_CANCEL_HOURS)
    if timezone.now() >= limit:
        return round_franc(d(booking.price_total) * settings.CARPOOL_LATE_CANCEL_FEE_RATE)
    return ZERO


@transaction.atomic
def driver_action(trip_id, driver_user, action: str, reason: str = "") -> CarpoolTrip:
    trip = _locked_trip(trip_id)
    if trip.driver_id != driver_user.id:
        raise NotFound("Trajet introuvable.")
    now = timezone.now()
    if action == "cancel":
        if trip.status not in (TripStatus.PUBLISHED, TripStatus.IN_PROGRESS):
            raise Conflict("Ce trajet ne peut plus être annulé.", code="invalid_transition")
        for b in _confirmed_bookings(trip):
            _release_booking(b)
            b.status = CarpoolBookingStatus.CANCELLED_BY_DRIVER
            b.cancelled_at = now
            b.save(update_fields=["status", "cancelled_at", "updated_at"])
        trip.status = TripStatus.CANCELLED
        trip.status_reason = reason or None
        trip.cancelled_at = now
        trip.save(update_fields=["status", "status_reason", "cancelled_at", "updated_at"])
        transaction.on_commit(
            lambda: _broadcast_trip(
                trip,
                "Covoiturage annulé",
                f"Le trajet vers {trip.destination_address} est annulé ; vos fonds sont libérés.",
            )
        )
    elif action == "start":
        if trip.status != TripStatus.PUBLISHED:
            raise Conflict("Ce trajet ne peut pas démarrer.", code="invalid_transition")
        if now < trip.departure_at - timedelta(hours=1):
            raise Conflict(
                "Le trajet ne peut démarrer qu'une heure avant l'heure prévue.", code="too_early"
            )
        trip.status = TripStatus.IN_PROGRESS
        trip.started_at = now
        trip.save(update_fields=["status", "started_at", "updated_at"])
        transaction.on_commit(
            lambda: _broadcast_trip(trip, "Covoiturage démarré", "Le conducteur est en route.")
        )
    elif action == "complete":
        if trip.status != TripStatus.IN_PROGRESS:
            raise Conflict("Le trajet n'est pas en cours.", code="invalid_transition")
        for b in _confirmed_bookings(trip):
            commission = round_franc(d(b.price_total) * settings.CARPOOL_COMMISSION_RATE)
            if b.price_total > ZERO:
                result = payments.settle_service(
                    b.passenger,
                    trip.driver,
                    b.price_total,
                    commission,
                    kind=KIND,
                    reference=str(b.id),
                )
                b.commission_amount = result["commission"]
            else:
                b.commission_amount = ZERO
            b.status = CarpoolBookingStatus.COMPLETED
            b.completed_at = now
            b.save(update_fields=["status", "commission_amount", "completed_at", "updated_at"])
        trip.status = TripStatus.COMPLETED
        trip.completed_at = now
        trip.save(update_fields=["status", "completed_at", "updated_at"])
        transaction.on_commit(
            lambda: _broadcast_trip(
                trip, "Covoiturage terminé", "Merci d'avoir voyagé avec VTC 242."
            )
        )
    else:
        raise NotFound("Action inconnue.")
    return trip


def _expired_notifier(trip: CarpoolTrip):
    def notify() -> None:
        _broadcast_trip(
            trip, "Covoiturage expiré", "Le trajet n'a pas été démarré ; vos fonds sont libérés."
        )

    return notify


def expire_trips() -> int:
    """Trajets publiés jamais démarrés 24 h après l'heure prévue : expirés, fonds libérés."""
    n = 0
    cutoff = timezone.now() - timedelta(hours=24)
    for trip_id in CarpoolTrip.objects.filter(
        status=TripStatus.PUBLISHED, departure_at__lt=cutoff
    ).values_list("id", flat=True):
        with transaction.atomic():
            trip = _locked_trip(trip_id)
            if trip.status != TripStatus.PUBLISHED:
                continue
            now = timezone.now()
            for b in _confirmed_bookings(trip):
                _release_booking(b)
                b.status = CarpoolBookingStatus.EXPIRED
                b.cancelled_at = now
                b.save(update_fields=["status", "cancelled_at", "updated_at"])
            trip.status = TripStatus.EXPIRED
            trip.cancelled_at = now
            trip.save(update_fields=["status", "cancelled_at", "updated_at"])
            transaction.on_commit(_expired_notifier(trip))
            n += 1
    return n
