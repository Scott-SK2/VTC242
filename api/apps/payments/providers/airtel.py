"""Airtel Money Open API (section 8.3)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

import httpx
from django.conf import settings
from django.core.cache import cache

from .base import CollectionResult, PaymentProvider, ProviderStatus, WebhookEvent

log = logging.getLogger("vtc242.payments.airtel")

_STATUS_MAP: dict[str, ProviderStatus] = {
    "TS": "completed",
    "TF": "failed",
    "TIP": "pending",
    "TA": "pending",
    "SUCCESS": "completed",
    "FAILED": "failed",
}


class AirtelMoneyProvider(PaymentProvider):
    operator = "airtel"

    def __init__(self) -> None:
        self.cfg = settings.AIRTEL
        self.base = self.cfg["BASE_URL"].rstrip("/")

    def _token(self) -> str:
        token = cache.get("airtel:token")
        if token:
            return token
        r = httpx.post(
            f"{self.base}/auth/oauth2/token",
            json={
                "client_id": self.cfg["CLIENT_ID"],
                "client_secret": self.cfg["CLIENT_SECRET"],
                "grant_type": "client_credentials",
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        cache.set(
            "airtel:token",
            data["access_token"],
            timeout=max(60, int(data.get("expires_in", 3600)) - 60),
        )
        return data["access_token"]

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token()}",
            "X-Country": "CG",
            "X-Currency": "XAF",
            "Content-Type": "application/json",
        }

    def initiate_collection(self, amount, phone_number, idempotency_key):
        body = {
            "reference": idempotency_key,
            "subscriber": {
                "country": "CG",
                "currency": "XAF",
                "msisdn": phone_number.lstrip("+")[3:],
            },
            "transaction": {
                "amount": str(int(amount)),
                "country": "CG",
                "currency": "XAF",
                "id": idempotency_key,
            },
        }
        r = httpx.post(
            f"{self.base}/merchant/v1/payments/", headers=self._headers(), json=body, timeout=20
        )
        data = r.json() if r.content else {}
        ok = r.status_code == 200 and data.get("status", {}).get("success", False)
        return CollectionResult(idempotency_key, "pending" if ok else "failed", data)

    def initiate_disbursement(self, amount, phone_number, idempotency_key):
        body = {
            "payee": {"msisdn": phone_number.lstrip("+")[3:]},
            "reference": idempotency_key,
            "pin": "",
            "transaction": {"amount": str(int(amount)), "id": idempotency_key},
        }
        r = httpx.post(
            f"{self.base}/standard/v1/disbursements/",
            headers=self._headers(),
            json=body,
            timeout=20,
        )
        data = r.json() if r.content else {}
        ok = r.status_code == 200 and data.get("status", {}).get("success", False)
        return CollectionResult(idempotency_key, "pending" if ok else "failed", data)

    def get_status(self, external_reference, kind) -> ProviderStatus:
        path = "standard/v1/payments" if kind == "collection" else "standard/v1/disbursements"
        r = httpx.get(
            f"{self.base}/{path}/{external_reference}", headers=self._headers(), timeout=15
        )
        if r.status_code != 200:
            return "unknown"
        status = r.json().get("data", {}).get("transaction", {}).get("status", "")
        return _STATUS_MAP.get(status, "unknown")

    def parse_webhook(self, headers, body):
        secret = self.cfg["WEBHOOK_SECRET"]
        if secret:
            sig = headers.get("X-Auth-Token") or headers.get("x-auth-token") or ""
            expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                raise ValueError("Signature Airtel invalide.")
        data = json.loads(body or b"{}")
        tx = data.get("transaction", data)
        ref = tx.get("id") or tx.get("reference")
        if not ref:
            raise ValueError("Référence Airtel absente.")
        status = tx.get("status_code") or tx.get("status") or ""
        return WebhookEvent(ref, _STATUS_MAP.get(status, "unknown"), data)
