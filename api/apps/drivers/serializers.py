from __future__ import annotations

from rest_framework import serializers

from apps.geo.serializers import ZoneSerializer

from . import services
from .models import DocumentType, Driver, DriverDocument, Vehicle


class VehicleSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = Vehicle
        fields = (
            "id",
            "brand",
            "model",
            "color",
            "license_plate",
            "taxi_number",
            "category",
            "seats",
            "is_verified",
            "is_active",
        )
        read_only_fields = ("id", "is_verified")

    def validate(self, attrs):
        if attrs.get("category") == "taxi" and not attrs.get("taxi_number"):
            raise serializers.ValidationError(
                {"taxi_number": "Numéro de taxi obligatoire pour un taxi conventionné."}
            )
        return attrs


class DriverDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverDocument
        fields = ("id", "type", "file_url", "status", "review_note", "expires_at", "created_at")
        read_only_fields = ("id", "status", "review_note", "created_at")


class DriverProfileSerializer(serializers.ModelSerializer):
    zone = ZoneSerializer(read_only=True)
    documents_summary = serializers.SerializerMethodField()
    can_go_online = serializers.SerializerMethodField()
    blocking_reason = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    category = serializers.CharField(read_only=True)
    rating_avg = serializers.FloatField(read_only=True)

    class Meta:
        model = Driver
        fields = (
            "id",
            "status",
            "status_reason",
            "license_number",
            "rating_avg",
            "rating_count",
            "is_online",
            "is_available",
            "active_vehicle_id",
            "category",
            "consecutive_declines",
            "paused_until",
            "last_location_at",
            "location",
            "zone",
            "documents_summary",
            "can_go_online",
            "blocking_reason",
        )

    def get_documents_summary(self, obj):
        return services.documents_summary(obj)

    def get_blocking_reason(self, obj):
        return services.blocking_reason(obj)

    def get_can_go_online(self, obj):
        return services.blocking_reason(obj) is None

    def get_location(self, obj):
        if obj.current_location is None:
            return None
        return {
            "lat": obj.current_location.y,
            "lng": obj.current_location.x,
            "heading": obj.heading,
        }


class StatusSerializer(serializers.Serializer):
    is_online = serializers.BooleanField()


class PositionSerializer(serializers.Serializer):
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    heading = serializers.FloatField(required=False, allow_null=True)
    speed_kmh = serializers.FloatField(required=False, allow_null=True)
    accuracy_m = serializers.FloatField(required=False, allow_null=True)
    recorded_at = serializers.DateTimeField(required=False)
    ride_id = serializers.UUIDField(required=False, allow_null=True)


class PositionBatchSerializer(serializers.Serializer):
    positions = PositionSerializer(many=True)


class DocumentCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=DocumentType.choices)
    file_url = serializers.URLField(max_length=1000)
    expires_at = serializers.DateField(required=False, allow_null=True)


class VehicleActivateSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()
