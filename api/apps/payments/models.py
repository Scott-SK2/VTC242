from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q, Value
from django.db.models.functions import Greatest

from apps.common.models import TimeStampedModel


class TransactionType(models.TextChoices):
    DEPOSIT = "deposit", "Recharge"
    RIDE_PAYMENT = "ride_payment", "Paiement de course"
    RIDE_EARNING = "ride_earning", "Gain de course"
    COMMISSION = "commission", "Commission"
    PAYOUT = "payout", "Retrait"
    REFUND = "refund", "Remboursement"
    CANCELLATION_FEE = "cancellation_fee", "Frais d'annulation"
    ADJUSTMENT = "adjustment", "Ajustement"
    SERVICE_PAYMENT = "service_payment", "Paiement de prestation"  # location, covoiturage
    SERVICE_EARNING = "service_earning", "Gain de prestation"


class TransactionStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    COMPLETED = "completed", "Terminée"
    FAILED = "failed", "Échouée"
    EXPIRED = "expired", "Expirée"


class PaymentMethod(models.TextChoices):
    WALLET = "wallet", "Wallet"
    CASH = "cash", "Espèces"


class MobileOperator(models.TextChoices):
    MTN = "mtn", "MTN MoMo"
    AIRTEL = "airtel", "Airtel Money"


class Wallet(models.Model):
    """1:1 users. Le solde n'est jamais modifié hors services.py (section 6.3)."""

    id = models.UUIDField(primary_key=True, default=__import__("uuid").uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wallet"
    )
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    reserved_balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=3, default="XAF")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "wallets"
        constraints = [
            models.CheckConstraint(
                condition=Q(reserved_balance__gte=0)
                & Q(reserved_balance__lte=Greatest(F("balance"), Value(0))),
                name="wallet_reserved_within_balance",
                violation_error_message="Le montant réservé dépasse le solde.",
            )
        ]

    def __str__(self) -> str:
        return f"Wallet {self.user_id} : {self.balance} {self.currency}"

    @property
    def available(self) -> Decimal:
        return self.balance - self.reserved_balance


class WalletTransaction(TimeStampedModel):
    """Grand livre (section 6.2) : montant signé, idempotence stricte."""

    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name="transactions")
    ride = models.ForeignKey(
        "rides.Ride", null=True, blank=True, on_delete=models.SET_NULL, related_name="transactions"
    )
    type = models.CharField(max_length=20, choices=TransactionType.choices)
    status = models.CharField(
        max_length=10, choices=TransactionStatus.choices, default=TransactionStatus.PENDING
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(
        max_length=10, choices=PaymentMethod.choices, default=PaymentMethod.WALLET
    )
    operator = models.CharField(
        max_length=10, choices=MobileOperator.choices, null=True, blank=True
    )
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    idempotency_key = models.CharField(max_length=80, unique=True)
    external_reference = models.CharField(max_length=120, unique=True, null=True, blank=True)
    provider_payload = models.JSONField(default=dict, blank=True)
    failure_reason = models.CharField(max_length=200, blank=True, null=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_polled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "wallet_transactions"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["status", "type"]),
            models.Index(fields=["wallet", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.type} {self.amount} ({self.status})"


class PayoutStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    AWAITING_APPROVAL = "awaiting_approval", "Validation manuelle"
    PROCESSING = "processing", "En cours"
    COMPLETED = "completed", "Versé"
    FAILED = "failed", "Échoué"
    REJECTED = "rejected", "Rejeté"


class PayoutRequest(TimeStampedModel):
    driver = models.ForeignKey("drivers.Driver", on_delete=models.PROTECT, related_name="payouts")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    operator = models.CharField(max_length=10, choices=MobileOperator.choices)
    phone_number = models.CharField(max_length=20)
    status = models.CharField(
        max_length=20, choices=PayoutStatus.choices, default=PayoutStatus.PENDING
    )
    transaction = models.OneToOneField(
        WalletTransaction, on_delete=models.PROTECT, related_name="payout_request"
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    note = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "payout_requests"
        ordering = ("-created_at",)


class ReconciliationReport(TimeStampedModel):
    operator = models.CharField(max_length=10, choices=MobileOperator.choices)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    rows_total = models.PositiveIntegerField(default=0)
    matched = models.PositiveIntegerField(default=0)
    mismatched = models.JSONField(default=list)
    missing = models.JSONField(default=list)

    class Meta:
        db_table = "reconciliation_reports"
