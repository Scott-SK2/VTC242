from __future__ import annotations

from rest_framework import serializers

from apps.common.geo import line_to_coords
from apps.geo.serializers import PlaceSerializer, ZoneSerializer
from apps.payments.models import PaymentMethod

from .models import ChatMessage, Dispute, Ride, RideEvent, RideRating


class EstimateRequestSerializer(serializers.Serializer):
    pickup = PlaceSerializer()
    dropoff = PlaceSerializer()


class RideCreateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=("taxi", "standard", "vip", "wedding", "moving"))
    pricing_rule_id = serializers.UUIDField()
    payment_method = serializers.ChoiceField(
        choices=PaymentMethod.choices, default=PaymentMethod.WALLET
    )
    pickup = PlaceSerializer()
    dropoff = PlaceSerializer()


class PositionBodySerializer(serializers.Serializer):
    lat = serializers.FloatField(required=False, allow_null=True)
    lng = serializers.FloatField(required=False, allow_null=True)


class StartSerializer(PositionBodySerializer):
    otp_code = serializers.CharField(min_length=4, max_length=4)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class RateSerializer(serializers.Serializer):
    score = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class MessageCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=500, required=False, allow_blank=True)
    preset = serializers.CharField(max_length=20, required=False)


class EmergencySerializer(PositionBodySerializer):
    number_called = serializers.CharField(max_length=10)


class DisputeSerializer(serializers.ModelSerializer):
    ride_id = serializers.UUIDField(source="ride.id", read_only=True)

    class Meta:
        model = Dispute
        fields = (
            "id",
            "ride_id",
            "reason",
            "status",
            "resolution",
            "refund_amount",
            "created_at",
            "resolved_at",
        )


class MessageSerializer(serializers.ModelSerializer):
    ride_id = serializers.UUIDField(source="ride.id", read_only=True)

    class Meta:
        model = ChatMessage
        fields = ("id", "ride_id", "sender_role", "body", "sent_at", "read_at")


class RideEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = RideEvent
        fields = ("id", "event_type", "actor_id", "payload", "occurred_at")


class RideSerializer(serializers.ModelSerializer):
    """Vue passager / chauffeur (context["role"]). Jamais de numéro de téléphone (A-18)."""

    pickup = serializers.SerializerMethodField()
    dropoff = serializers.SerializerMethodField()
    planned_route = serializers.SerializerMethodField()
    driver = serializers.SerializerMethodField()
    passenger = serializers.SerializerMethodField()
    otp_code = serializers.SerializerMethodField()
    otp_locked = serializers.SerializerMethodField()
    zone = ZoneSerializer(read_only=True)
    cancellation_fee_preview = serializers.SerializerMethodField()
    my_rating = serializers.SerializerMethodField()
    dispute = serializers.SerializerMethodField()
    deviation = serializers.SerializerMethodField()
    share_token = serializers.SerializerMethodField()

    class Meta:
        model = Ride
        fields = (
            "id",
            "status",
            "category",
            "payment_method",
            "type",
            "pickup",
            "dropoff",
            "planned_route",
            "planned_distance_m",
            "planned_duration_s",
            "actual_distance_m",
            "estimated_price_min",
            "estimated_price_max",
            "reserved_amount",
            "final_price",
            "commission_amount",
            "driver_earning",
            "cancellation_fee",
            "waiting_seconds",
            "ride_seconds",
            "otp_code",
            "otp_locked",
            "driver",
            "passenger",
            "zone",
            "cancellation_fee_preview",
            "requested_at",
            "accepted_at",
            "arrived_at",
            "started_at",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "dispute_deadline_at",
            "passenger_confirmed_arrival_at",
            "my_rating",
            "dispute",
            "deviation",
            "detour_until",
            "share_token",
        )

    @property
    def role(self) -> str:
        return self.context.get("role", "passenger")

    def get_pickup(self, obj):
        return {
            "lat": obj.pickup_location.y,
            "lng": obj.pickup_location.x,
            "address": obj.pickup_address,
        }

    def get_dropoff(self, obj):
        return {
            "lat": obj.dropoff_location.y,
            "lng": obj.dropoff_location.x,
            "address": obj.dropoff_address,
        }

    def get_planned_route(self, obj):
        return line_to_coords(obj.planned_route)

    def get_otp_code(self, obj):
        return obj.otp_code_plain if self.role == "passenger" and obj.is_active else None

    def get_otp_locked(self, obj):
        return obj.otp_locked_at is not None

    def get_driver(self, obj):
        drv = obj.driver
        if drv is None:
            return None
        v = obj.vehicle or drv.active_vehicle
        loc = None
        if drv.current_location and obj.is_active:
            loc = {
                "lat": drv.current_location.y,
                "lng": drv.current_location.x,
                "heading": drv.heading,
            }
        return {
            "id": str(drv.id),
            "first_name": drv.user.first_name,
            "photo_url": drv.user.photo_url,
            "rating": float(drv.rating_avg),
            "rating_count": drv.rating_count,
            "vehicle": {
                "brand": v.brand,
                "model": v.model,
                "color": v.color,
                "license_plate": v.license_plate,
                "taxi_number": v.taxi_number,
                "category": v.category,
            }
            if v
            else None,
            "location": loc,
        }

    def get_passenger(self, obj):
        if self.role == "passenger":
            return None
        p = obj.passenger
        return {
            "id": str(p.id),
            "first_name": p.first_name,
            "last_initial": p.last_initial,
            "rating": float(p.rating_avg),
        }

    def get_cancellation_fee_preview(self, obj):
        from .services import cancellation_fee_preview

        return str(cancellation_fee_preview(obj, self.role))

    def get_my_rating(self, obj):
        user = self.context.get("user")
        if user is None:
            return None
        r = RideRating.objects.filter(ride=obj, rater=user).first()
        return {"score": r.score, "comment": r.comment} if r else None

    def get_dispute(self, obj):
        d = getattr(obj, "dispute", None) if hasattr(obj, "dispute") else None
        try:
            d = obj.dispute
        except Dispute.DoesNotExist:
            d = None
        return DisputeSerializer(d).data if d else None

    def get_deviation(self, obj):
        if not obj.is_active:
            return None
        dev = (
            obj.deviations.filter(alert_sent_at__isnull=False, cleared_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if dev is None:
            return None
        return {
            "active": True,
            "distance_off_m": dev.distance_off_m,
            "since": dev.alert_sent_at.isoformat(),
        }

    def get_share_token(self, obj):
        if self.role != "passenger":
            return None
        share = obj.shares.order_by("-created_at").first()
        return share.token if share else None
