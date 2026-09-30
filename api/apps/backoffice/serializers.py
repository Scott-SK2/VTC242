from __future__ import annotations

from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer
from apps.common.geo import line_to_coords
from apps.drivers.models import DriverDocument
from apps.drivers.serializers import (
    DriverDocumentSerializer,
    DriverProfileSerializer,
    VehicleSerializer,
)
from apps.rides.models import Dispute, Ride
from apps.rides.serializers import (
    DisputeSerializer,
    MessageSerializer,
    RideEventSerializer,
    RideSerializer,
)
from apps.safety.models import Alert

from .models import AuditLog


class AlertSerializer(serializers.ModelSerializer):
    driver = serializers.SerializerMethodField()
    passenger = serializers.SerializerMethodField()
    ride_id = serializers.UUIDField(source="ride.id", read_only=True, default=None)

    class Meta:
        model = Alert
        fields = (
            "id",
            "type",
            "ride_id",
            "driver",
            "passenger",
            "payload",
            "status",
            "acknowledged_by_id",
            "acknowledged_at",
            "created_at",
        )

    def get_driver(self, obj):
        if obj.ride and obj.ride.driver:
            return {"first_name": obj.ride.driver.user.first_name, "id": str(obj.ride.driver.id)}
        return None

    def get_passenger(self, obj):
        if obj.ride:
            return {"first_name": obj.ride.passenger.first_name, "id": str(obj.ride.passenger.id)}
        return None


class AdminRideSerializer(RideSerializer):
    passenger_phone = serializers.CharField(source="passenger.phone_number", read_only=True)
    driver_phone = serializers.SerializerMethodField()
    passenger_name = serializers.CharField(source="passenger.public_name", read_only=True)
    events = serializers.SerializerMethodField()
    positions = serializers.SerializerMethodField()
    messages = serializers.SerializerMethodField()
    actual_route = serializers.SerializerMethodField()
    offers = serializers.SerializerMethodField()

    class Meta(RideSerializer.Meta):
        fields = RideSerializer.Meta.fields + (
            "passenger_phone",
            "driver_phone",
            "passenger_name",
            "price_capped",
            "events",
            "positions",
            "messages",
            "actual_route",
            "offers",
        )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("context", {})
        kwargs["context"].setdefault("role", "admin")
        super().__init__(*args, **kwargs)

    def get_otp_code(self, obj):
        return obj.otp_code_plain

    def get_passenger(self, obj):
        p = obj.passenger
        return {
            "id": str(p.id),
            "first_name": p.first_name,
            "last_initial": p.last_initial,
            "rating": float(p.rating_avg),
        }

    def get_driver_phone(self, obj):
        return obj.driver.user.phone_number if obj.driver else None

    def _detail(self) -> bool:
        return bool(self.context.get("detail"))

    def get_events(self, obj):
        return RideEventSerializer(obj.events.all(), many=True).data if self._detail() else []

    def get_positions(self, obj):
        if not self._detail():
            return []
        return [
            {
                "lat": p.location.y,
                "lng": p.location.x,
                "recorded_at": p.recorded_at,
                "speed_kmh": p.speed_kmh,
            }
            for p in obj.positions.all()[:2000]
        ]

    def get_messages(self, obj):
        return MessageSerializer(obj.messages.all(), many=True).data if self._detail() else []

    def get_actual_route(self, obj):
        return line_to_coords(obj.actual_route)

    def get_offers(self, obj):
        if not self._detail():
            return []
        return [
            {
                "driver_id": str(o.driver_id),
                "driver_name": o.driver.user.first_name,
                "response": o.response,
                "offered_at": o.offered_at,
                "distance_m": o.distance_m,
            }
            for o in obj.offers.select_related("driver__user")
        ]


class AdminDriverSerializer(serializers.Serializer):
    """Contrat : User + `driver` (DriverProfile) + `documents[]` + `vehicles[]`.

    `id` est l'identifiant chauffeur (routes /admin/drivers/{id})."""

    def to_representation(self, obj):
        user = UserSerializer(obj.user).data
        user.pop("driver", None)
        wallet = getattr(obj.user, "wallet", None)
        return {
            **user,
            "id": str(obj.id),
            "user_id": str(obj.user_id),
            "status": obj.status,
            "status_reason": obj.status_reason,
            "driver": DriverProfileSerializer(obj).data,
            "documents": DriverDocumentSerializer(obj.documents.all(), many=True).data,
            "vehicles": VehicleSerializer(obj.vehicles.all(), many=True).data,
            "rides_count": obj.rides.filter(status="completed").count(),
            "wallet_balance": str(wallet.balance) if wallet else "0.00",
            "driver_created_at": obj.created_at,
        }


class AdminPassengerSerializer(UserSerializer):
    rides_count = serializers.SerializerMethodField()
    wallet_balance = serializers.SerializerMethodField()
    is_blocked = serializers.SerializerMethodField()
    blocked_reason = serializers.CharField(read_only=True)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + (
            "rides_count",
            "wallet_balance",
            "is_blocked",
            "blocked_reason",
        )

    def get_rides_count(self, obj):
        return obj.rides.count()

    def get_wallet_balance(self, obj):
        w = getattr(obj, "wallet", None)
        return str(w.balance) if w else "0.00"

    def get_is_blocked(self, obj):
        return not obj.is_active and obj.deleted_at is None


class AdminDisputeSerializer(DisputeSerializer):
    ride = serializers.SerializerMethodField()
    opened_by_name = serializers.CharField(source="opened_by.public_name", read_only=True)

    class Meta(DisputeSerializer.Meta):
        fields = DisputeSerializer.Meta.fields + ("ride", "opened_by_name")

    def get_ride(self, obj):
        return AdminRideSerializer(
            obj.ride, context={"detail": self.context.get("detail", False)}
        ).data


class DocumentReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("approved", "rejected"))
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class SimulateSerializer(serializers.Serializer):
    zone_id = serializers.UUIDField()
    category = serializers.CharField()
    distance_m = serializers.IntegerField(min_value=0)
    duration_s = serializers.IntegerField(min_value=0)
    waiting_seconds = serializers.IntegerField(min_value=0, default=0)
    at = serializers.DateTimeField(required=False)


class ResolveDisputeSerializer(serializers.Serializer):
    refund_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    resolution = serializers.CharField(max_length=500)


class AuditLogSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "actor",
            "action",
            "target_type",
            "target_id",
            "diff",
            "ip_address",
            "created_at",
        )

    def get_actor(self, obj):
        return (
            {"id": str(obj.actor_id), "name": obj.actor.public_name, "role": obj.actor.role}
            if obj.actor
            else None
        )


class StaffUserCreateSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20)
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(choices=("admin", "finance", "support"))


class TotpVerifySerializer(serializers.Serializer):
    code = serializers.CharField(min_length=6, max_length=6)


__all__ = [
    "AlertSerializer",
    "AdminRideSerializer",
    "AdminDriverSerializer",
    "AdminPassengerSerializer",
    "AdminDisputeSerializer",
    "DocumentReviewSerializer",
    "ReasonSerializer",
    "SimulateSerializer",
    "ResolveDisputeSerializer",
    "AuditLogSerializer",
    "StaffUserCreateSerializer",
    "TotpVerifySerializer",
    "User",
    "DriverDocument",
    "Ride",
    "Dispute",
]
