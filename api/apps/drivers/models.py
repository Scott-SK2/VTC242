from __future__ import annotations

from django.conf import settings
from django.contrib.gis.db import models as gis
from django.db import models

from apps.common.models import TimeStampedModel
from apps.geo.models import VehicleCategory, Zone


class DriverStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    APPROVED = "approved", "Validé"
    SUSPENDED = "suspended", "Suspendu"
    REJECTED = "rejected", "Refusé"


class DocumentType(models.TextChoices):
    LICENSE = "license", "Permis de conduire"
    REGISTRATION = "registration", "Carte grise"
    INSURANCE = "insurance", "Assurance"
    TAXI_CARD = "taxi_card", "Carte de taxi"
    ID_CARD = "id_card", "Pièce d'identité"
    VEHICLE_PHOTO = "vehicle_photo", "Photo du véhicule"
    PROFILE_PHOTO = "profile_photo", "Photo de profil"


class DocumentStatus(models.TextChoices):
    PENDING = "pending", "En vérification"
    APPROVED = "approved", "Validé"
    REJECTED = "rejected", "Refusé"


REQUIRED_DOCUMENTS = (
    DocumentType.LICENSE,
    DocumentType.REGISTRATION,
    DocumentType.INSURANCE,
    DocumentType.ID_CARD,
    DocumentType.PROFILE_PHOTO,
    DocumentType.VEHICLE_PHOTO,
)


class Driver(TimeStampedModel):
    """Profil chauffeur, 1:1 avec users (section 6.2)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="driver"
    )
    status = models.CharField(
        max_length=12, choices=DriverStatus.choices, default=DriverStatus.PENDING
    )
    status_reason = models.TextField(blank=True, null=True)
    license_number = models.CharField(max_length=40, blank=True)
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, default=5)
    rating_count = models.PositiveIntegerField(default=0)
    active_vehicle = models.ForeignKey(
        "Vehicle", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    is_online = models.BooleanField(default=False, db_index=True)
    is_available = models.BooleanField(default=False, db_index=True)
    current_location = gis.PointField(srid=4326, null=True, blank=True)
    heading = models.FloatField(null=True, blank=True)
    last_location_at = models.DateTimeField(null=True, blank=True)
    position_lost_notified = models.BooleanField(default=False)
    zone = models.ForeignKey(
        Zone, null=True, blank=True, on_delete=models.SET_NULL, related_name="drivers"
    )
    consecutive_declines = models.PositiveSmallIntegerField(default=0)
    paused_until = models.DateTimeField(null=True, blank=True)
    online_since = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "drivers"

    def __str__(self) -> str:
        return f"Chauffeur {self.user.first_name} ({self.status})"

    @property
    def category(self) -> str | None:
        return (
            self.active_vehicle.category if self.active_vehicle_id and self.active_vehicle else None
        )


class Vehicle(TimeStampedModel):
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="vehicles")
    brand = models.CharField(max_length=60)
    model = models.CharField(max_length=60)
    color = models.CharField(max_length=40)
    license_plate = models.CharField(max_length=20, unique=True)
    taxi_number = models.CharField(max_length=20, blank=True, null=True)
    category = models.CharField(max_length=16, choices=VehicleCategory.choices)
    seats = models.PositiveSmallIntegerField(default=4)
    is_verified = models.BooleanField(default=False)

    class Meta:
        db_table = "vehicles"

    def __str__(self) -> str:
        return f"{self.brand} {self.model} {self.license_plate}"

    @property
    def is_active(self) -> bool:
        return self.driver.active_vehicle_id == self.id


class DriverDocument(TimeStampedModel):
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="documents")
    type = models.CharField(max_length=16, choices=DocumentType.choices)
    file_url = models.URLField(max_length=1000)
    expires_at = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=10, choices=DocumentStatus.choices, default=DocumentStatus.PENDING
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    review_note = models.TextField(blank=True, null=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "driver_documents"
        ordering = ("-created_at",)
