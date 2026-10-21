from __future__ import annotations

from django.conf import settings
from django.contrib.gis.db import models as gis
from django.db import models

from apps.common.models import TimeStampedModel


class RouteDeviation(TimeStampedModel):
    ride = models.ForeignKey("rides.Ride", on_delete=models.CASCADE, related_name="deviations")
    recorded_location = gis.PointField(srid=4326)
    distance_off_m = models.IntegerField()
    consecutive_count = models.PositiveSmallIntegerField(default=0)
    alert_sent_at = models.DateTimeField(null=True, blank=True)
    cleared_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "route_deviations"
        ordering = ("-created_at",)


class EmergencyCall(TimeStampedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_calls"
    )
    ride = models.ForeignKey(
        "rides.Ride",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="emergency_calls",
    )
    number_called = models.CharField(max_length=10)
    location = gis.PointField(srid=4326, null=True, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "emergency_calls"


class AlertType(models.TextChoices):
    DEVIATION = "deviation", "Déviation"
    EMERGENCY = "emergency", "Urgence"
    OTP_LOCKED = "otp_locked", "Codes erronés"
    DETOUR = "detour", "Détour signalé"
    POSITION_LOST = "position_lost", "Position perdue"
    PRICE_CAPPED = "price_capped", "Débit plafonné"
    BALANCE_MISMATCH = "balance_mismatch", "Écart de solde"
    NO_DRIVERS_ONLINE = "no_drivers_online", "Aucun chauffeur en ligne"
    HIGH_CANCELLATION = "high_cancellation", "Taux d'annulation élevé"


class AlertStatus(models.TextChoices):
    OPEN = "open", "Ouverte"
    ACKNOWLEDGED = "acknowledged", "Prise en charge"


class Alert(TimeStampedModel):
    """Journal des alertes du back-office (F-52)."""

    type = models.CharField(max_length=20, choices=AlertType.choices)
    ride = models.ForeignKey(
        "rides.Ride", null=True, blank=True, on_delete=models.SET_NULL, related_name="alerts"
    )
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=14, choices=AlertStatus.choices, default=AlertStatus.OPEN, db_index=True
    )
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "alerts"
        ordering = ("-created_at",)
