"""SandboxProvider : simule succès, refus et timeout sans dépendre des opérateurs (section 8.3).

Règles de recette : montant se terminant par 1 → refusé ; par 2 → aucune réponse (expire) ;
sinon succès
livré ~3 s plus tard par un « webhook » interne.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal

from django.core.cache import cache

from .base import CollectionResult, PaymentProvider, ProviderStatus, WebhookEvent


def _outcome(amount: Decimal) -> ProviderStatus:
    units = int(Decimal(amount)) % 10
    if units == 1:
        return "failed"
    if units == 2:
        return "pending"
    return "completed"


class SandboxProvider(PaymentProvider):
    def __init__(self, operator: str = "mtn") -> None:
        self.operator = operator

    def _start(self, amount: Decimal, kind: str, idempotency_key: str) -> CollectionResult:
        ref = f"SBX-{self.operator.upper()}-{uuid.uuid4().hex[:12]}"
        outcome = _outcome(amount)
        cache.set(f"sandbox:tx:{ref}", outcome, timeout=3600)
        if outcome != "pending":
            from apps.payments.tasks import sandbox_deliver_webhook

            sandbox_deliver_webhook.apply_async(args=[self.operator, ref, outcome], countdown=3)
        return CollectionResult(ref, "pending", {"sandbox": True, "kind": kind, "outcome": outcome})

    def initiate_collection(self, amount, phone_number, idempotency_key):
        return self._start(amount, "collection", idempotency_key)

    def initiate_disbursement(self, amount, phone_number, idempotency_key):
        return self._start(amount, "disbursement", idempotency_key)

    def get_status(self, external_reference, kind):
        return cache.get(f"sandbox:tx:{external_reference}", "unknown")

    def parse_webhook(self, headers, body):
        data = json.loads(body or b"{}")
        if "reference" not in data or "status" not in data:
            raise ValueError("Webhook sandbox invalide.")
        return WebhookEvent(data["reference"], data["status"], data)
