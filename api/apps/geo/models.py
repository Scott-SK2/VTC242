from __future__ import annotations

from decimal import Decimal

from django.contrib.gis.db import models as gis
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from apps.common.models import TimeStampedModel


class VehicleCategory(models.TextChoices):
    TAXI = "taxi", "Taxi conventionné"
    STANDARD = "standard", "Standard"
    VIP = "vip", "VIP"
    WEDDING = "wedding", "Mariage & événements"
    MOVING = "moving", "Utilitaire / déménagement"


QUOTE_ONLY_CATEGORIES = (VehicleCategory.WEDDING,)


class Zone(TimeStampedModel):
    """Périmètre de service (F-56)."""

    name = models.CharField(max_length=80)
    city = models.CharField(max_length=80, default="Brazzaville")
    polygon = gis.MultiPolygonField(srid=4326)
    emergency_police = models.CharField(max_length=10, default="117")
    emergency_fire = models.CharField(max_length=10, default="118")
    cash_enabled = models.BooleanField(default=False)
    deviation_threshold_m = models.PositiveIntegerField(default=300)
    deviation_hits = models.PositiveSmallIntegerField(default=3)
    cash_debt_limit = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("-5000.00")
    )
    min_driver_rating = models.DecimalField(max_digits=3, decimal_places=2, default=Decimal("3.50"))
    payout_min = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("2000.00"))
    payout_daily_cap = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("200000.00")
    )
    payout_manual_threshold = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("100000.00")
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "zones"

    def __str__(self) -> str:
        return self.name

    @classmethod
    def resolve(cls, point) -> Zone | None:
        return cls.objects.filter(is_active=True, polygon__contains=point).first()


class PointOfInterest(TimeStampedModel):
    """Référentiel de lieux locaux administrable (F-11, F-57)."""

    name = models.CharField(max_length=120)
    aliases = ArrayField(models.CharField(max_length=120), default=list, blank=True)
    location = gis.PointField(srid=4326)
    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name="pois")
    secondary = models.CharField(max_length=160, blank=True)

    class Meta:
        db_table = "points_of_interest"

    def __str__(self) -> str:
        return self.name


class PricingRule(TimeStampedModel):
    """Grille tarifaire versionnée par zone et catégorie (F-55)."""

    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name="pricing_rules")
    category = models.CharField(max_length=16, choices=VehicleCategory.choices)
    base_fare = models.DecimalField(max_digits=12, decimal_places=2)
    per_km = models.DecimalField(max_digits=12, decimal_places=2)
    per_minute = models.DecimalField(max_digits=12, decimal_places=2)
    minimum_fare = models.DecimalField(max_digits=12, decimal_places=2)
    free_waiting_seconds = models.PositiveIntegerField(default=180)
    waiting_per_minute = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cancellation_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    driver_cancellation_share = models.DecimalField(
        max_digits=4, decimal_places=2, default=Decimal("0.50")
    )
    commission_rate = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("0.15"))
    surge_multiplier = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("1.00"))
    cash_enabled = models.BooleanField(default=False)
    effective_from = models.DateTimeField(default=timezone.now)
    effective_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "pricing_rules"
        indexes = [models.Index(fields=["zone", "category", "effective_from"])]

    def __str__(self) -> str:
        return f"{self.zone} / {self.category} ({self.effective_from:%Y-%m-%d})"

    @classmethod
    def active_for(cls, zone: Zone, category: str, at=None) -> PricingRule | None:
        at = at or timezone.now()
        return (
            cls.objects.filter(zone=zone, category=category, effective_from__lte=at)
            .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gt=at))
            .order_by("-effective_from")
            .first()
        )
