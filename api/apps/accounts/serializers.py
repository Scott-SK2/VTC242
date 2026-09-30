from __future__ import annotations

from rest_framework import serializers

from .models import PushSubscription, User


class DriverSummarySerializer(serializers.Serializer):
    """Résumé du profil chauffeur embarqué dans /me (détail dans apps.drivers)."""

    def to_representation(self, driver):
        from apps.drivers.serializers import DriverProfileSerializer

        return DriverProfileSerializer(driver).data


class UserSerializer(serializers.ModelSerializer):
    driver = serializers.SerializerMethodField()
    rating_avg = serializers.FloatField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "phone_number",
            "first_name",
            "last_name",
            "role",
            "photo_url",
            "language",
            "is_active",
            "created_at",
            "driver",
            "totp_enabled",
            "rating_avg",
            "rating_count",
        )
        read_only_fields = ("id", "phone_number", "role", "is_active", "created_at", "totp_enabled")

    def get_driver(self, obj):
        driver = getattr(obj, "driver", None)
        if driver is None:
            return None
        from apps.drivers.serializers import DriverProfileSerializer

        return DriverProfileSerializer(driver).data


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("first_name", "last_name", "photo_url", "language")

    def validate_language(self, value):
        if value != "fr":
            raise serializers.ValidationError("Seul le français est disponible en V1.")
        return value


class OtpRequestSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20)


class OtpVerifySerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=20)
    code = serializers.CharField(min_length=6, max_length=6)
    role = serializers.ChoiceField(choices=("passenger", "driver"), required=False)
    device_id = serializers.CharField(max_length=64, required=False)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class PushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=1000)
    keys = serializers.DictField(child=serializers.CharField())
    user_agent = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def create(self, validated):
        keys = validated["keys"]
        sub, _ = PushSubscription.objects.update_or_create(
            endpoint=validated["endpoint"],
            defaults={
                "user": self.context["request"].user,
                "p256dh": keys.get("p256dh", ""),
                "auth": keys.get("auth", ""),
                "user_agent": validated.get("user_agent", ""),
            },
        )
        return sub


class UploadRequestSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=("profile_photo", "document", "vehicle_photo"))
    content_type = serializers.CharField()
    filename = serializers.CharField(max_length=200)
