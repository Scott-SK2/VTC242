from rest_framework import serializers

from .models import MobileOperator, PayoutRequest, WalletTransaction


class WalletSerializer(serializers.Serializer):
    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    reserved_balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    available = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    cash_debt_limit = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    payout_min = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    payout_daily_cap = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)


class TransactionSerializer(serializers.ModelSerializer):
    ride_id = serializers.UUIDField(source="ride.id", read_only=True, default=None)

    class Meta:
        model = WalletTransaction
        fields = (
            "id",
            "type",
            "status",
            "amount",
            "method",
            "operator",
            "external_reference",
            "ride_id",
            "failure_reason",
            "created_at",
            "completed_at",
        )


class DepositSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=100)
    operator = serializers.ChoiceField(choices=MobileOperator.choices)
    phone_number = serializers.CharField(max_length=20)


class PayoutSerializer(DepositSerializer):
    pass


class PayoutRequestSerializer(serializers.ModelSerializer):
    driver_name = serializers.CharField(source="driver.user.public_name", read_only=True)
    driver_phone = serializers.CharField(source="driver.user.phone_number", read_only=True)
    transaction = TransactionSerializer(read_only=True)

    class Meta:
        model = PayoutRequest
        fields = (
            "id",
            "driver_id",
            "driver_name",
            "driver_phone",
            "amount",
            "operator",
            "phone_number",
            "status",
            "transaction",
            "processed_at",
            "processed_by_id",
            "note",
            "created_at",
        )
