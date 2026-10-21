"""Location de véhicules avec ou sans chauffeur (service complémentaire)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class RentalMode(models.TextChoices):
    WITH_DRIVER = "with_driver", "Avec chauffeur"
    WITHOUT_DRIVER = "without_driver", "Sans chauffeur"


class ListingStatus(models.TextChoices):
    PENDING = "pending", "En attente de validation"
    APPROVED = "approved", "Validée"
    SUSPENDED = "suspended", "Suspendue"


class RentalListing(TimeStampedModel):
    """Annonce publiée par un chauffeur / prestataire, validée par le back-office."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rental_listings"
    )
    vehicle = models.ForeignKey(
        "drivers.Vehicle", on_delete=models.PROTECT, related_name="rental_listings"
    )
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    city = models.CharField(max_length=80, default="Brazzaville")
    price_per_day_with_driver = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    price_per_day_without_driver = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    min_days = models.PositiveSmallIntegerField(default=1)
    photo_url = models.URLField(max_length=1000, blank=True, null=True)
    status = models.CharField(
        max_length=12, choices=ListingStatus.choices, default=ListingStatus.PENDING, db_index=True
    )
    status_reason = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "rental_listings"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.title} ({self.get_status_display()})"

    @property
    def modes(self) -> list[str]:
        out: list[str] = []
        if self.price_per_day_with_driver is not None:
            out.append(RentalMode.WITH_DRIVER)
        if self.price_per_day_without_driver is not None:
            out.append(RentalMode.WITHOUT_DRIVER)
        return out

    def price_for(self, mode: str) -> Decimal | None:
        if mode == RentalMode.WITH_DRIVER:
            return self.price_per_day_with_driver
        return self.price_per_day_without_driver

    @property
    def is_bookable(self) -> bool:
        return self.status == ListingStatus.APPROVED and self.is_active


class BookingStatus(models.TextChoices):
    REQUESTED = "requested", "Demandée"
    ACCEPTED = "accepted", "Acceptée"
    DECLINED = "declined", "Refusée"
    IN_PROGRESS = "in_progress", "En cours"
    COMPLETED = "completed", "Terminée"
    CANCELLED_BY_RENTER = "cancelled_by_renter", "Annulée par le client"
    CANCELLED_BY_OWNER = "cancelled_by_owner", "Annulée par le loueur"
    EXPIRED = "expired", "Expirée"


BOOKING_BLOCKING_STATUSES = (BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS)
BOOKING_OPEN_STATUSES = (BookingStatus.REQUESTED, BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS)


class RentalBooking(TimeStampedModel):
    """Réservation d'un véhicule : fonds réservés sur le wallet à la demande, débités à la
    fin de la location (commission plateforme), caution libérée."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(RentalListing, on_delete=models.PROTECT, related_name="bookings")
    renter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="rental_bookings"
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="rental_orders"
    )
    mode = models.CharField(max_length=16, choices=RentalMode.choices)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveSmallIntegerField()
    price_per_day = models.DecimalField(max_digits=12, decimal_places=2)
    total_price = models.DecimalField(max_digits=12, decimal_places=2)
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    commission_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cancellation_fee = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    status = models.CharField(
        max_length=24, choices=BookingStatus.choices, default=BookingStatus.REQUESTED, db_index=True
    )
    note = models.TextField(blank=True)
    status_reason = models.TextField(blank=True, null=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "rental_bookings"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["listing", "start_date", "end_date"])]

    @property
    def reserved_total(self) -> Decimal:
        return self.total_price + self.deposit_amount
