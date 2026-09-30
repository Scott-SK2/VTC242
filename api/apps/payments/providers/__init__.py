from __future__ import annotations

from django.conf import settings

from .airtel import AirtelMoneyProvider
from .base import CollectionResult, PaymentProvider, ProviderStatus, WebhookEvent
from .mtn import MtnMomoProvider
from .sandbox import SandboxProvider

__all__ = [
    "PaymentProvider",
    "CollectionResult",
    "ProviderStatus",
    "WebhookEvent",
    "SandboxProvider",
    "MtnMomoProvider",
    "AirtelMoneyProvider",
    "get_provider",
]


def get_provider(operator: str) -> PaymentProvider:
    if settings.PAYMENT_PROVIDER_MODE != "live":
        return SandboxProvider(operator)
    if operator == "mtn":
        return MtnMomoProvider()
    if operator == "airtel":
        return AirtelMoneyProvider()
    raise ValueError(f"Opérateur inconnu : {operator}")
