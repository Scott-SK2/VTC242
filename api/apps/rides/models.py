from __future__ import annotations

from django.conf import settings
from django.contrib.gis.db import models as gis
from django.db import models
from django.db.models import Q

from apps.common.models import TimeStampedModel
from apps.geo.models import PricingRule, VehicleCategory, Zone
from apps.payments.models import PaymentMethod


class RideType(models.TextChoices):
    IMMEDIATE = "immediate", "Immédiat"
    SCHEDULED = "scheduled", "Réservé"  # V3
    SHARED = "shared", "Covoiturage"  # V3
    RENTAL = "rental", "Location"  # V3


class RideStatus(models.TextChoices):
    REQUESTED = "requested", "Demandée"
    DISPATCHING = "dispatching", "Recherche d'un chauffeur"
    ACCEPTED = "accepted", "Acceptée"
    ARRIVED = "arrived", "Chauffeur arrivé"
    IN_PROGRESS = "in_progress", "En cours"
    COMPLETED = "completed", "Terminée"
    CANCELLED_BY_PASSENGER = "cancelled_by_passenger", "Annulée par le passager"
    CANCELLED_BY_DRIVER = "cancelled_by_driver", "Annulée par le chauffeur"
    NO_DRIVER = "no_driver", "Aucun chauffeur"


ACTIVE_STATUSES = (
    RideStatus.REQUESTED,
    RideStatus.DISPATCHING,
    # fonds réservés, en attente de la décision du passager (relancer / annuler)
    RideStatus.NO_DRIVER,
    RideStatus.ACCEPTED,
    RideStatus.ARRIVED,
    RideStatus.IN_PROGRESS,
)
TERMINAL_STATUSES = (
    RideStatus.COMPLETED,
    RideStatus.CANCELLED_BY_PASSENGER,
    RideStatus.CANCELLED_BY_DRIVER,
)

# Machine à états (section 7.2)
TRANSITIONS: dict[str, tuple[str, ...]] = {
    RideStatus.REQUESTED: (
        RideStatus.DISPATCHING,
        RideStatus.CANCELLED_BY_PASSENGER,
        RideStatus.NO_DRIVER,
    ),
    RideStatus.DISPATCHING: (
        RideStatus.ACCEPTED,
        RideStatus.NO_DRIVER,
        RideStatus.CANCELLED_BY_PASSENGER,
    ),
    RideStatus.NO_DRIVER: (RideStatus.DISPATCHING, RideStatus.CANCELLED_BY_PASSENGER),
    RideStatus.ACCEPTED: (
        RideStatus.ARRIVED,
        RideStatus.CANCELLED_BY_PASSENGER,
        RideStatus.CANCELLED_BY_DRIVER,
    ),
    RideStatus.ARRIVED: (
        RideStatus.IN_PROGRESS,
        RideStatus.CANCELLED_BY_PASSENGER,
        RideStatus.CANCELLED_BY_DRIVER,
    ),
    RideStatus.IN_PROGRESS: (RideStatus.COMPLETED, RideStatus.CANCELLED_BY_DRIVER),
}


class Ride(TimeStampedModel):
    """Course (DDL section 6.3)."""

    type = models.CharField(max_length=12, choices=RideType.choices, default=RideType.IMMEDIATE)
    passenger = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="rides"
    )
    driver = models.ForeignKey(
        "drivers.Driver", null=True, blank=True, on_delete=models.PROTECT, related_name="rides"
    )
    vehicle = models.ForeignKey(
        "drivers.Vehicle", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    category = models.CharField(max_length=16, choices=VehicleCategory.choices)
    status = models.CharField(
        max_length=24, choices=RideStatus.choices, default=RideStatus.REQUESTED, db_index=True
    )
    payment_method = models.CharField(
        max_length=10, choices=PaymentMethod.choices, default=PaymentMethod.WALLET
    )
    pricing_rule = models.ForeignKey(PricingRule, on_delete=models.PROTECT, related_name="rides")
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="rides")
    otp_code_hash = models.TextField()
    otp_code_plain = models.CharField(max_length=4)  # renvoyé au passager uniquement (section 6.3)
    otp_attempts = models.PositiveSmallIntegerField(default=0)
    otp_verified_at = models.DateTimeField(null=True, blank=True)
    otp_locked_at = models.DateTimeField(null=True, blank=True)
    pickup_location = gis.PointField(srid=4326)
    dropoff_location = gis.PointField(srid=4326)
    pickup_address = models.TextField()
    dropoff_address = models.TextField()
    planned_route = gis.LineStringField(srid=4326, null=True, blank=True)
    planned_distance_m = models.IntegerField(null=True, blank=True)
    planned_duration_s = models.IntegerField(null=True, blank=True)
    actual_route = gis.LineStringField(srid=4326, null=True, blank=True)
    actual_distance_m = models.IntegerField(null=True, blank=True)
    waiting_seconds = models.IntegerField(default=0)
    ride_seconds = models.IntegerField(default=0)
    estimated_price_min = models.DecimalField(max_digits=12, decimal_places=2)
    estimated_price_max = models.DecimalField(max_digits=12, decimal_places=2)
    reserved_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    commission_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    driver_earning = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cancellation_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    price_capped = models.BooleanField(default=False)
    requested_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.TextField(null=True, blank=True)
    dispute_deadline_at = models.DateTimeField(null=True, blank=True)
    passenger_confirmed_arrival_at = models.DateTimeField(null=True, blank=True)
    detour_until = models.DateTimeField(null=True, blank=True)
    dispatch_started_at = models.DateTimeField(null=True, blank=True)
    offers_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "rides"
        ordering = ("-requested_at",)
        indexes = [
            models.Index(fields=["passenger", "-requested_at"], name="idx_rides_passenger"),
            models.Index(fields=["driver", "-requested_at"], name="idx_rides_driver"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["passenger"],
                condition=Q(status__in=ACTIVE_STATUSES),
                name="uq_rides_active_passenger",
            )
        ]

    def __str__(self) -> str:
        return f"Course {self.id} ({self.status})"

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_STATUSES


class RideEvent(TimeStampedModel):
    """Journal immuable (section 6.2)."""

    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=40)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    payload = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ride_events"
        ordering = ("occurred_at",)


class OfferResponse(models.TextChoices):
    ACCEPTED = "accepted", "Acceptée"
    DECLINED = "declined", "Refusée"
    TIMEOUT = "timeout", "Sans réponse"


class RideOffer(TimeStampedModel):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="offers")
    driver = models.ForeignKey("drivers.Driver", on_delete=models.CASCADE, related_name="offers")
    offered_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    response = models.CharField(max_length=10, choices=OfferResponse.choices, null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    distance_m = models.IntegerField(default=0)
    estimated_earning = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = "ride_offers"
        ordering = ("offered_at",)


class RidePosition(models.Model):
    """Positions GPS brutes, conservées 90 jours."""

    id = models.BigAutoField(primary_key=True)
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="positions")
    driver = models.ForeignKey("drivers.Driver", on_delete=models.CASCADE, related_name="+")
    location = gis.PointField(srid=4326)
    speed_kmh = models.FloatField(null=True, blank=True)
    heading = models.FloatField(null=True, blank=True)
    accuracy_m = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "ride_positions"
        ordering = ("recorded_at",)

    def __str__(self) -> str:
        return f"Position {self.ride_id} @ {self.recorded_at:%H:%M:%S}"


class RideRating(TimeStampedModel):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="ratings")
    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_given"
    )
    ratee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_received"
    )
    score = models.PositiveSmallIntegerField()
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "ride_ratings"
        constraints = [
            models.UniqueConstraint(fields=["ride", "rater"], name="uq_rating_ride_rater")
        ]


class ChatMessage(TimeStampedModel):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    sender_role = models.CharField(max_length=12)
    body = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "chat_messages"
        ordering = ("sent_at",)


class TripShare(TimeStampedModel):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name="shares")
    token = models.CharField(max_length=48, unique=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "trip_shares"


class DisputeStatus(models.TextChoices):
    OPEN = "open", "Ouvert"
    RESOLVED = "resolved", "Résolu"
    REJECTED = "rejected", "Rejeté"


class Dispute(TimeStampedModel):
    ride = models.OneToOneField(Ride, on_delete=models.CASCADE, related_name="dispute")
    opened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    reason = models.TextField()
    status = models.CharField(
        max_length=10, choices=DisputeStatus.choices, default=DisputeStatus.OPEN
    )
    resolution = models.TextField(blank=True, null=True)
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "disputes"
        ordering = ("-created_at",)
