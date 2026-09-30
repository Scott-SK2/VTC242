from rest_framework import serializers

from apps.common.geo import point

from .models import PointOfInterest, PricingRule, Zone


class LatLngSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


class PlaceSerializer(LatLngSerializer):
    address = serializers.CharField(max_length=300)


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = (
            "id",
            "name",
            "city",
            "emergency_police",
            "emergency_fire",
            "cash_enabled",
            "deviation_threshold_m",
            "deviation_hits",
            "is_active",
        )


class AdminZoneSerializer(serializers.ModelSerializer):
    polygon = serializers.JSONField()

    class Meta:
        model = Zone
        fields = (
            "id",
            "name",
            "city",
            "polygon",
            "emergency_police",
            "emergency_fire",
            "cash_enabled",
            "deviation_threshold_m",
            "deviation_hits",
            "cash_debt_limit",
            "min_driver_rating",
            "payout_min",
            "payout_daily_cap",
            "payout_manual_threshold",
            "is_active",
            "created_at",
            "updated_at",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        import json

        data["polygon"] = json.loads(instance.polygon.geojson)
        return data

    def validate_polygon(self, value):
        import json

        from django.contrib.gis.geos import GEOSGeometry, MultiPolygon

        try:
            geom = GEOSGeometry(json.dumps(value) if isinstance(value, dict) else value, srid=4326)
        except Exception as exc:
            raise serializers.ValidationError(f"GeoJSON invalide : {exc}")
        if geom.geom_type == "Polygon":
            geom = MultiPolygon(geom, srid=4326)
        if geom.geom_type != "MultiPolygon":
            raise serializers.ValidationError("Polygon ou MultiPolygon attendu.")
        return geom


class PointOfInterestSerializer(serializers.ModelSerializer):
    lat = serializers.FloatField(write_only=True)
    lng = serializers.FloatField(write_only=True)

    class Meta:
        model = PointOfInterest
        fields = ("id", "name", "aliases", "secondary", "lat", "lng", "zone")
        extra_kwargs = {"zone": {"required": False}}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["lat"] = instance.location.y
        data["lng"] = instance.location.x
        data["zone_id"] = str(instance.zone_id)
        return data

    def _apply_location(self, validated):
        lat = validated.pop("lat", None)
        lng = validated.pop("lng", None)
        if lat is not None and lng is not None:
            validated["location"] = point(lat, lng)
            if "zone" not in validated:
                zone = Zone.resolve(validated["location"])
                if zone is None:
                    raise serializers.ValidationError({"lat": "Point hors de toute zone active."})
                validated["zone"] = zone
        return validated

    def create(self, validated):
        return super().create(self._apply_location(validated))

    def update(self, instance, validated):
        return super().update(instance, self._apply_location(validated))


class PricingRuleSerializer(serializers.ModelSerializer):
    zone_id = serializers.PrimaryKeyRelatedField(source="zone", queryset=Zone.objects.all())

    class Meta:
        model = PricingRule
        fields = (
            "id",
            "zone_id",
            "category",
            "base_fare",
            "per_km",
            "per_minute",
            "minimum_fare",
            "free_waiting_seconds",
            "waiting_per_minute",
            "cancellation_fee",
            "driver_cancellation_share",
            "commission_rate",
            "surge_multiplier",
            "cash_enabled",
            "effective_from",
            "effective_to",
            "created_at",
        )
