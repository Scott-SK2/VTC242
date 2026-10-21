from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from apps.common.geo import point_to_dict
from apps.geo.serializers import PlaceSerializer
from apps.rentals.serializers import OwnerSummarySerializer, VehicleSummarySerializer

from .models import CarpoolBooking, CarpoolTrip


class CarpoolTripSerializer(serializers.ModelSerializer):
    driver = OwnerSummarySerializer(read_only=True)
    vehicle = VehicleSummarySerializer(read_only=True)
    origin = serializers.SerializerMethodField()
    destination = serializers.SerializerMethodField()
    seats_available = serializers.IntegerField(read_only=True)
    seats_booked = serializers.IntegerField(read_only=True)

    class Meta:
        model = CarpoolTrip
        fields = (
            "id",
            "driver",
            "vehicle",
            "origin",
            "destination",
            "departure_at",
            "seats_total",
            "seats_available",
            "seats_booked",
            "price_per_seat",
            "description",
            "status",
            "status_reason",
            "started_at",
            "completed_at",
            "cancelled_at",
            "created_at",
        )
        read_only_fields = fields

    def get_origin(self, trip) -> dict:
        return {**(point_to_dict(trip.origin_location) or {}), "address": trip.origin_address}

    def get_destination(self, trip) -> dict:
        return {
            **(point_to_dict(trip.destination_location) or {}),
            "address": trip.destination_address,
        }


class CarpoolTripInputSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure_at = serializers.DateTimeField()
    seats_total = serializers.IntegerField(min_value=1, max_value=8)
    price_per_seat = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    description = serializers.CharField(
        allow_blank=True, required=False, default="", max_length=500
    )

    def validate_departure_at(self, value):
        if value <= timezone.now() + timezone.timedelta(minutes=15):
            raise serializers.ValidationError("Le départ doit être au moins dans 15 minutes.")
        return value


class CarpoolBookingSerializer(serializers.ModelSerializer):
    trip = CarpoolTripSerializer(read_only=True)
    passenger = OwnerSummarySerializer(read_only=True)

    class Meta:
        model = CarpoolBooking
        fields = (
            "id",
            "trip",
            "passenger",
            "seats",
            "price_total",
            "commission_amount",
            "cancellation_fee",
            "status",
            "status_reason",
            "completed_at",
            "cancelled_at",
            "created_at",
        )
        read_only_fields = fields


class CarpoolBookInputSerializer(serializers.Serializer):
    seats = serializers.IntegerField(min_value=1, max_value=8, required=False, default=1)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True, required=False, default="", max_length=500)
