"""MTN MoMo Collection / Disbursement API (section 8.3).

Identifiants fournis à l'onboarding marchand."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from decimal import Decimal
from typing import Any

import httpx
from django.conf import settings
from django.core.cache import cache

from .base import CollectionResult, PaymentProvider, ProviderStatus, WebhookEvent

log = logging.getLogger("vtc242.payments.mtn")

_STATUS_MAP: dict[str, ProviderStatus] = {
    "SUCCESSFUL": "completed",
    "FAILED": "failed",
    "PENDING": "pending",
}


class MtnMomoProvider(PaymentProvider):
    operator = "mtn"

    def __init__(self) -> None:
        self.cfg = settings.MTN
        self.base = self.cfg["BASE_URL"].rstrip("/")

    # --- auth -----------------------------------------------------------------
    def _token(self, product: str) -> str:
        key = f"mtn:token:{product}"
        token = cache.get(key)
        if token:
            return token
        basic = base64.b64encode(f"{self.cfg['API_USER']}:{self.cfg['API_KEY']}".encode()).decode()
        r = httpx.post(
            f"{self.base}/{product}/token/",
            headers={
                "Authorization": f"Basic {basic}",
                "Ocp-Apim-Subscription-Key": self.cfg["SUBSCRIPTION_KEY"],
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        cache.set(
            key, data["access_token"], timeout=max(60, int(data.get("expires_in", 3600)) - 60)
        )
        return data["access_token"]

    def _headers(self, product: str, reference: str | None = None) -> dict[str, str]:
        h = {
            "Authorization": f"Bearer {self._token(product)}",
            "X-Target-Environment": self.cfg["TARGET_ENVIRONMENT"],
            "Ocp-Apim-Subscription-Key": self.cfg["SUBSCRIPTION_KEY"],
            "Content-Type": "application/json",
        }
        if reference:
            h["X-Reference-Id"] = reference
        return h

    # --- flux -----------------------------------------------------------------
    def _initiate(
        self, product: str, path: str, amount: Decimal, phone: str, key: str, message: str
    ):
        body: dict[str, Any] = {
            "amount": str(int(amount)),
            "currency": "XAF",
            "externalId": key,
            "payerMessage" if product == "collection" else "payeeNote": message,
            "payeeNote": message,
        }
        party = {"partyIdType": "MSISDN", "partyId": phone.lstrip("+")}
        body["payer" if product == "collection" else "payee"] = party
        r = httpx.post(
            f"{self.base}/{product}/v1_0/{path}",
            headers=self._headers(product, key),
            json=body,
            timeout=20,
        )
        if r.status_code not in (202, 200):
            log.error("MTN %s refusé : %s %s", path, r.status_code, r.text)
            return CollectionResult(key, "failed", {"status_code": r.status_code, "body": r.text})
        return CollectionResult(key, "pending", {"status_code": r.status_code})

    def initiate_collection(self, amount, phone_number, idempotency_key):
        return self._initiate(
            "collection", "requesttopay", amount, phone_number, idempotency_key, "Recharge VTC 242"
        )

    def initiate_disbursement(self, amount, phone_number, idempotency_key):
        return self._initiate(
            "disbursement", "transfer", amount, phone_number, idempotency_key, "Retrait VTC 242"
        )

    def get_status(self, external_reference, kind) -> ProviderStatus:
        product = "collection" if kind == "collection" else "disbursement"
        path = "requesttopay" if kind == "collection" else "transfer"
        r = httpx.get(
            f"{self.base}/{product}/v1_0/{path}/{external_reference}",
            headers=self._headers(product),
            timeout=15,
        )
        if r.status_code != 200:
            return "unknown"
        return _STATUS_MAP.get(r.json().get("status", ""), "unknown")

    def parse_webhook(self, headers, body):
        secret = self.cfg["WEBHOOK_SECRET"]
        if secret:
            sig = headers.get("X-Signature") or headers.get("x-signature") or ""
            expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                raise ValueError("Signature MTN invalide.")
        data = json.loads(body or b"{}")
        ref = data.get("referenceId") or data.get("externalId") or headers.get("X-Reference-Id")
        if not ref:
            raise ValueError("Référence MTN absente.")
        return WebhookEvent(
            ref,
            _STATUS_MAP.get(data.get("status", ""), "unknown"),
            {**data, "received_at": time.time()},
        )
