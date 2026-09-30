"""Interface PaymentProvider (section 5 et 8.3)."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

ProviderStatus = Literal["pending", "completed", "failed", "unknown"]


@dataclass
class CollectionResult:
    external_reference: str
    status: ProviderStatus
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class WebhookEvent:
    external_reference: str
    status: ProviderStatus
    payload: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(abc.ABC):
    operator: str

    @abc.abstractmethod
    def initiate_collection(
        self, amount: Decimal, phone_number: str, idempotency_key: str
    ) -> CollectionResult:
        """Recharge : USSD push vers le client (section 8.1)."""

    @abc.abstractmethod
    def initiate_disbursement(
        self, amount: Decimal, phone_number: str, idempotency_key: str
    ) -> CollectionResult:
        """Retrait chauffeur (section 8.2)."""

    @abc.abstractmethod
    def get_status(self, external_reference: str, kind: str) -> ProviderStatus:
        """Polling de secours."""

    @abc.abstractmethod
    def parse_webhook(self, headers: dict[str, str], body: bytes) -> WebhookEvent:
        """Vérifie la signature et extrait la référence et le statut ;
        lève ValueError si invalide."""
