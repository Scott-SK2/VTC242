"""Covoiturage : trajets urbains ou interurbains publiés par des chauffeurs validés,
places réservées par les passagers (fonds réservés sur le wallet, débités à l'arrivée)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.conf import settings
from django.contrib.gis.db import models as gis
from django.db import models

from apps.common.models import TimeStampedModel


class TripStatus(models.TextChoices):
    PUBLISHED = "published", "Publié"
    IN_PROGRESS = "in_progress", "En cours"
    COMPLETED = "completed", "Terminé"
    CANCELLED = "cancelled", "Annulé"
    EXPIRED = "expired", "Expiré"


class CarpoolTrip(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="carpool_trips"
    )
    vehicle = models.ForeignKey(
        "drivers.Vehicle", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    origin_address = models.CharField(max_length=300)
    origin_location = gis.PointField(geography=True, srid=4326)
    destination_address = models.CharField(max_length=300)
    destination_location = gis.PointField(geography=True, srid=4326)
    departure_at = models.DateTimeField(db_index=True)
    seats_total = models.PositiveSmallIntegerField()
    price_per_seat = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=12, choices=TripStatus.choices, default=TripStatus.PUBLISHED, db_index=True
    )
    status_reason = models.TextField(blank=True, null=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "carpool_trips"
        ordering = ("departure_at",)

    def __str__(self) -> str:
        return (
            f"{self.origin_address} → {self.destination_address} ({self.departure_at:%d/%m %H:%M})"
        )

    @property
    def seats_booked(self) -> int:
        return sum(
            b.seats for b in self.bookings.all() if b.status == CarpoolBookingStatus.CONFIRMED
        )

    @property
    def seats_available(self) -> int:
        return max(0, self.seats_total - self.seats_booked)


class CarpoolBookingStatus(models.TextChoices):
    CONFIRMED = "confirmed", "Confirmée"
    COMPLETED = "completed", "Terminée"
    CANCELLED_BY_PASSENGER = "cancelled_by_passenger", "Annulée par le passager"
    CANCELLED_BY_DRIVER = "cancelled_by_driver", "Annulée par le conducteur"
    EXPIRED = "expired", "Expirée"


class CarpoolBooking(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip = models.ForeignKey(CarpoolTrip, on_delete=models.PROTECT, related_name="bookings")
    passenger = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="carpool_bookings"
    )
    seats = models.PositiveSmallIntegerField(default=1)
    price_total = models.DecimalField(max_digits=12, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cancellation_fee = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    status = models.CharField(
        max_length=24,
        choices=CarpoolBookingStatus.choices,
        default=CarpoolBookingStatus.CONFIRMED,
        db_index=True,
    )
    status_reason = models.TextField(blank=True, null=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "carpool_bookings"
        ordering = ("-created_at",)
