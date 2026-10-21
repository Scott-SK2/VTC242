from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.drivers.models import Vehicle

from .models import RentalBooking, RentalListing, RentalMode


class VehicleSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = ("id", "brand", "model", "color", "license_plate", "category", "seats")


class OwnerSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    first_name = serializers.CharField()
    rating_avg = serializers.SerializerMethodField()

    def get_rating_avg(self, user) -> float | None:
        driver = getattr(user, "driver", None)
        return float(driver.rating_avg) if driver else None


class RentalListingSerializer(serializers.ModelSerializer):
    vehicle = VehicleSummarySerializer(read_only=True)
    owner = OwnerSummarySerializer(read_only=True)
    modes = serializers.ListField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = RentalListing
        fields = (
            "id",
            "title",
            "description",
            "city",
            "vehicle",
            "owner",
            "modes",
            "price_per_day_with_driver",
            "price_per_day_without_driver",
            "deposit_amount",
            "min_days",
            "photo_url",
            "status",
            "status_reason",
            "is_active",
            "created_at",
        )
        read_only_fields = fields


class RentalListingInputSerializer(serializers.Serializer):
    vehicle_id = serializers.UUIDField()
    title = serializers.CharField(max_length=120)
    description = serializers.CharField(allow_blank=True, required=False, default="")
    city = serializers.CharField(max_length=80, required=False, default="Brazzaville")
    price_per_day_with_driver = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False, allow_null=True
    )
    price_per_day_without_driver = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False, allow_null=True
    )
    deposit_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False, default=Decimal("0")
    )
    min_days = serializers.IntegerField(min_value=1, max_value=90, required=False, default=1)
    photo_url = serializers.URLField(required=False, allow_null=True, allow_blank=True)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        if (
            attrs.get("price_per_day_with_driver") is None
            and attrs.get("price_per_day_without_driver") is None
        ):
            raise serializers.ValidationError(
                "Indiquez au moins un tarif : avec chauffeur ou sans chauffeur."
            )
        return attrs


class RentalListingPatchSerializer(RentalListingInputSerializer):
    vehicle_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=120, required=False)

    def validate(self, attrs):
        return attrs


class RentalBookingSerializer(serializers.ModelSerializer):
    listing = RentalListingSerializer(read_only=True)
    renter = OwnerSummarySerializer(read_only=True)
    owner = OwnerSummarySerializer(read_only=True)

    class Meta:
        model = RentalBooking
        fields = (
            "id",
            "listing",
            "renter",
            "owner",
            "mode",
            "start_date",
            "end_date",
            "days",
            "price_per_day",
            "total_price",
            "deposit_amount",
            "commission_amount",
            "cancellation_fee",
            "status",
            "note",
            "status_reason",
            "accepted_at",
            "started_at",
            "completed_at",
            "cancelled_at",
            "created_at",
        )
        read_only_fields = fields


class RentalBookingInputSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=RentalMode.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    note = serializers.CharField(allow_blank=True, required=False, default="", max_length=500)

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"end_date": "La date de fin précède le début."})
        return attrs


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True, required=False, default="", max_length=500)
