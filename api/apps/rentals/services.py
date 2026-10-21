"""Règles métier de la location : annonces validées par le back-office, réservation des fonds
sur le wallet, règlement à la fin, caution libérée, frais d'annulation tardive."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.exceptions import Conflict, Forbidden, NotFound, Unprocessable
from apps.common.money import ZERO, d, round_franc
from apps.common.push import send_push
from apps.drivers.models import Driver, DriverStatus, Vehicle
from apps.payments import services as payments
from apps.realtime import events

from .models import (
    BOOKING_BLOCKING_STATUSES,
    BookingStatus,
    ListingStatus,
    RentalBooking,
    RentalListing,
    RentalMode,
)

KIND = "rental"


def _notify_booking(booking: RentalBooking, title: str, body: str, *, to_owner: bool) -> None:
    from .serializers import RentalBookingSerializer

    data = RentalBookingSerializer(booking).data
    target = booking.owner if to_owner else booking.renter
    transaction.on_commit(lambda: events.send_to_user(target.id, "rental.booking_updated", data))
    transaction.on_commit(
        lambda: events.send_to_user(
            booking.renter.id if to_owner else booking.owner.id, "rental.booking_updated", data
        )
    )
    transaction.on_commit(lambda: send_push(target, title, body, {"booking_id": str(booking.id)}))


# --- annonces ------------------------------------------------------------------------
def _owner_driver(user) -> Driver:
    driver = Driver.objects.filter(user=user).first()
    if driver is None or driver.status != DriverStatus.APPROVED:
        raise Forbidden(
            "Votre dossier chauffeur doit être validé pour proposer un véhicule à la location.",
            code="driver_not_approved",
        )
    return driver


@transaction.atomic
def create_listing(user, data: dict) -> RentalListing:
    driver = _owner_driver(user)
    vehicle = Vehicle.objects.filter(pk=data["vehicle_id"], driver=driver).first()
    if vehicle is None:
        raise NotFound("Véhicule introuvable.")
    listing = RentalListing.objects.create(
        owner=user,
        vehicle=vehicle,
        title=data["title"],
        description=data.get("description", ""),
        city=data.get("city", "Brazzaville"),
        price_per_day_with_driver=data.get("price_per_day_with_driver"),
        price_per_day_without_driver=data.get("price_per_day_without_driver"),
        deposit_amount=data.get("deposit_amount") or ZERO,
        min_days=data.get("min_days") or 1,
        photo_url=data.get("photo_url") or None,
        is_active=data.get("is_active", True),
        status=ListingStatus.PENDING,
    )
    return listing


@transaction.atomic
def update_listing(user, listing: RentalListing, data: dict) -> RentalListing:
    if listing.owner_id != user.id:
        raise NotFound("Annonce introuvable.")
    if "vehicle_id" in data:
        driver = _owner_driver(user)
        vehicle = Vehicle.objects.filter(pk=data["vehicle_id"], driver=driver).first()
        if vehicle is None:
            raise NotFound("Véhicule introuvable.")
        listing.vehicle = vehicle
    for field in (
        "title",
        "description",
        "city",
        "price_per_day_with_driver",
        "price_per_day_without_driver",
        "deposit_amount",
        "min_days",
        "photo_url",
        "is_active",
    ):
        if field in data:
            setattr(listing, field, data[field] if data[field] != "" else None)
    if listing.price_per_day_with_driver is None and listing.price_per_day_without_driver is None:
        raise Unprocessable("Indiquez au moins un tarif.", code="validation_error")
    # une modification de prix / véhicule repasse par la validation
    if listing.status == ListingStatus.APPROVED and any(
        k in data
        for k in ("vehicle_id", "price_per_day_with_driver", "price_per_day_without_driver")
    ):
        listing.status = ListingStatus.PENDING
        listing.status_reason = None
    listing.save()
    return listing


@transaction.atomic
def review_listing(listing: RentalListing, action: str, reason: str = "") -> RentalListing:
    mapping = {
        "approve": ListingStatus.APPROVED,
        "suspend": ListingStatus.SUSPENDED,
        "reinstate": ListingStatus.APPROVED,
    }
    if action not in mapping:
        raise NotFound("Action inconnue.")
    listing.status = mapping[action]
    listing.status_reason = reason or None
    listing.save(update_fields=["status", "status_reason", "updated_at"])
    title = "Annonce de location"
    body = (
        "Votre annonce est validée et visible des clients."
        if listing.status == ListingStatus.APPROVED
        else f"Votre annonce a été suspendue. {reason}".strip()
    )
    transaction.on_commit(
        lambda: send_push(listing.owner, title, body, {"listing_id": str(listing.id)})
    )
    return listing


def overlapping(listing: RentalListing, start: date, end: date, exclude_id=None):
    qs = RentalBooking.objects.filter(
        listing=listing,
        status__in=BOOKING_BLOCKING_STATUSES,
        start_date__lte=end,
        end_date__gte=start,
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs


def availability(listing: RentalListing, days_ahead: int = 60) -> list[dict]:
    """Périodes déjà réservées (acceptées / en cours) à venir, pour le calendrier client."""
    today = timezone.localdate()
    horizon = today + timedelta(days=days_ahead)
    return [
        {"start_date": b.start_date.isoformat(), "end_date": b.end_date.isoformat()}
        for b in RentalBooking.objects.filter(
            listing=listing,
            status__in=BOOKING_BLOCKING_STATUSES,
            end_date__gte=today,
            start_date__lte=horizon,
        ).order_by("start_date")
    ]


# --- réservations ---------------------------------------------------------------------
@transaction.atomic
def create_booking(renter, data: dict) -> RentalBooking:
    listing = (
        RentalListing.objects.select_for_update()
        .select_related("owner", "vehicle")
        .filter(pk=data["listing_id"])
        .first()
    )
    if listing is None or not listing.is_bookable:
        raise NotFound("Annonce indisponible.")
    if listing.owner_id == renter.id:
        raise Conflict("Vous ne pouvez pas réserver votre propre véhicule.", code="own_listing")
    mode = data["mode"]
    price = listing.price_for(mode)
    if price is None:
        raise Unprocessable("Ce véhicule n'est pas proposé dans ce mode.", code="mode_unavailable")
    start, end = data["start_date"], data["end_date"]
    if start < timezone.localdate():
        raise Unprocessable("La date de début est passée.", code="validation_error")
    days = (end - start).days + 1
    if days < listing.min_days:
        raise Unprocessable(
            f"Durée minimale : {listing.min_days} jour(s).",
            code="min_days",
            details={"min_days": listing.min_days},
        )
    if overlapping(listing, start, end).exists():
        raise Conflict("Le véhicule est déjà réservé sur ces dates.", code="dates_unavailable")
    if RentalBooking.objects.filter(
        listing=listing, renter=renter, status=BookingStatus.REQUESTED
    ).exists():
        raise Conflict("Vous avez déjà une demande en attente pour ce véhicule.", code="duplicate")
    total = round_franc(d(price) * days)
    deposit = d(listing.deposit_amount) if mode == RentalMode.WITHOUT_DRIVER else ZERO
    payments.reserve(renter, total + deposit, what="cette location (prix et caution)")
    booking = RentalBooking.objects.create(
        listing=listing,
        renter=renter,
        owner=listing.owner,
        mode=mode,
        start_date=start,
        end_date=end,
        days=days,
        price_per_day=price,
        total_price=total,
        deposit_amount=deposit,
        note=data.get("note", ""),
    )
    _notify_booking(
        booking,
        "Nouvelle demande de location",
        f"{renter.first_name or 'Un client'} souhaite louer {listing.title} "
        f"du {start:%d/%m} au {end:%d/%m}.",
        to_owner=True,
    )
    return booking


def _locked_booking(booking_id) -> RentalBooking:
    booking = (
        RentalBooking.objects.select_for_update(of=("self",))
        .select_related("listing", "renter", "owner", "listing__vehicle")
        .filter(pk=booking_id)
        .first()
    )
    if booking is None:
        raise NotFound("Réservation introuvable.")
    return booking


def _release(booking: RentalBooking) -> None:
    if booking.reserved_total > ZERO:
        payments.release(booking.renter, booking.reserved_total)


@transaction.atomic
def owner_action(booking_id, owner, action: str, reason: str = "") -> RentalBooking:
    booking = _locked_booking(booking_id)
    if booking.owner_id != owner.id:
        raise NotFound("Réservation introuvable.")
    now = timezone.now()
    if action == "accept":
        if booking.status != BookingStatus.REQUESTED:
            raise Conflict("Cette demande n'est plus en attente.", code="invalid_transition")
        if overlapping(booking.listing, booking.start_date, booking.end_date, booking.id).exists():
            raise Conflict("Le véhicule est déjà réservé sur ces dates.", code="dates_unavailable")
        booking.status = BookingStatus.ACCEPTED
        booking.accepted_at = now
        booking.save(update_fields=["status", "accepted_at", "updated_at"])
        _notify_booking(
            booking,
            "Location acceptée",
            f"{booking.listing.title} : votre réservation du {booking.start_date:%d/%m} "
            "est confirmée.",
            to_owner=False,
        )
    elif action == "decline":
        if booking.status != BookingStatus.REQUESTED:
            raise Conflict("Cette demande n'est plus en attente.", code="invalid_transition")
        _release(booking)
        booking.status = BookingStatus.DECLINED
        booking.status_reason = reason or None
        booking.cancelled_at = now
        booking.save(update_fields=["status", "status_reason", "cancelled_at", "updated_at"])
        _notify_booking(
            booking,
            "Location refusée",
            "Le loueur a refusé votre demande. Vos fonds sont libérés.",
            to_owner=False,
        )
    elif action == "start":
        if booking.status != BookingStatus.ACCEPTED:
            raise Conflict("La réservation doit être acceptée.", code="invalid_transition")
        booking.status = BookingStatus.IN_PROGRESS
        booking.started_at = now
        booking.save(update_fields=["status", "started_at", "updated_at"])
        _notify_booking(booking, "Location démarrée", "Bonne route !", to_owner=False)
    elif action == "complete":
        if booking.status != BookingStatus.IN_PROGRESS:
            raise Conflict("La location n'est pas en cours.", code="invalid_transition")
        commission = round_franc(d(booking.total_price) * settings.RENTAL_COMMISSION_RATE)
        result = payments.settle_service(
            booking.renter,
            booking.owner,
            booking.total_price,
            commission,
            kind=KIND,
            reference=str(booking.id),
        )
        if booking.deposit_amount > ZERO:
            payments.release(booking.renter, booking.deposit_amount)
        booking.status = BookingStatus.COMPLETED
        booking.commission_amount = result["commission"]
        booking.completed_at = now
        booking.save(update_fields=["status", "commission_amount", "completed_at", "updated_at"])
        _notify_booking(
            booking,
            "Location terminée",
            f"Merci ! {booking.total_price:.0f} F ont été débités ; votre caution est libérée.",
            to_owner=False,
        )
    elif action == "cancel":
        if booking.status not in (BookingStatus.REQUESTED, BookingStatus.ACCEPTED):
            raise Conflict(
                "Cette réservation ne peut plus être annulée.", code="invalid_transition"
            )
        _release(booking)
        booking.status = BookingStatus.CANCELLED_BY_OWNER
        booking.status_reason = reason or None
        booking.cancelled_at = now
        booking.save(update_fields=["status", "status_reason", "cancelled_at", "updated_at"])
        _notify_booking(
            booking,
            "Location annulée par le loueur",
            "Vos fonds ont été libérés.",
            to_owner=False,
        )
    else:
        raise NotFound("Action inconnue.")
    return booking


@transaction.atomic
def renter_cancel(booking_id, renter, reason: str = "") -> RentalBooking:
    booking = _locked_booking(booking_id)
    if booking.renter_id != renter.id:
        raise NotFound("Réservation introuvable.")
    if booking.status not in (BookingStatus.REQUESTED, BookingStatus.ACCEPTED):
        raise Conflict("Cette réservation ne peut plus être annulée.", code="invalid_transition")
    fee = ZERO
    late = (booking.start_date - timezone.localdate()).days < settings.RENTAL_FREE_CANCEL_DAYS
    if booking.status == BookingStatus.ACCEPTED and late:
        fee = round_franc(d(booking.total_price) * settings.RENTAL_LATE_CANCEL_FEE_RATE)
        fee = payments.charge_service_cancellation(
            booking.renter,
            booking.owner,
            booking.reserved_total,
            fee,
            kind=KIND,
            reference=str(booking.id),
        )
    else:
        _release(booking)
    booking.status = BookingStatus.CANCELLED_BY_RENTER
    booking.cancellation_fee = fee
    booking.status_reason = reason or None
    booking.cancelled_at = timezone.now()
    booking.save(
        update_fields=["status", "cancellation_fee", "status_reason", "cancelled_at", "updated_at"]
    )
    _notify_booking(
        booking,
        "Réservation annulée",
        f"{booking.renter.first_name or 'Le client'} a annulé la location "
        f"du {booking.start_date:%d/%m}.",
        to_owner=True,
    )
    return booking


def expire_requests() -> int:
    """Demandes restées sans réponse dont la date de début est passée : expirées, fonds libérés."""
    n = 0
    today = timezone.localdate()
    for booking_id in RentalBooking.objects.filter(
        status=BookingStatus.REQUESTED, start_date__lt=today
    ).values_list("id", flat=True):
        with transaction.atomic():
            booking = _locked_booking(booking_id)
            if booking.status != BookingStatus.REQUESTED:
                continue
            _release(booking)
            booking.status = BookingStatus.EXPIRED
            booking.cancelled_at = timezone.now()
            booking.save(update_fields=["status", "cancelled_at", "updated_at"])
            _notify_booking(
                booking,
                "Demande de location expirée",
                "Le loueur n'a pas répondu à temps ; vos fonds sont libérés.",
                to_owner=False,
            )
            n += 1
    return n


def cancellation_preview(booking: RentalBooking) -> Decimal:
    late = (booking.start_date - timezone.localdate()).days < settings.RENTAL_FREE_CANCEL_DAYS
    if booking.status == BookingStatus.ACCEPTED and late:
        return round_franc(d(booking.total_price) * settings.RENTAL_LATE_CANCEL_FEE_RATE)
    return ZERO
