"""Envoi de SMS : Infobip en production, console / mémoire en local et test."""

from __future__ import annotations

import logging

import httpx
from django.conf import settings

log = logging.getLogger("vtc242.sms")
OUTBOX: list[dict[str, str]] = []


def send_sms(phone_number: str, body: str) -> None:
    backend = settings.SMS_BACKEND
    if backend == "memory":
        OUTBOX.append({"to": phone_number, "body": body})
        return
    if backend == "console" or not settings.INFOBIP_API_KEY:
        log.info("SMS → %s : %s", phone_number, body)
        return
    base = settings.INFOBIP_BASE_URL.rstrip("/")
    try:
        r = httpx.post(
            f"{base}/sms/2/text/advanced",
            headers={"Authorization": f"App {settings.INFOBIP_API_KEY}"},
            json={
                "messages": [
                    {
                        "from": settings.INFOBIP_SENDER,
                        "destinations": [{"to": phone_number.lstrip("+")}],
                        "text": body,
                    }
                ]
            },
            timeout=10,
        )
        r.raise_for_status()
    except httpx.HTTPError as exc:  # pragma: no cover - dépend du réseau
        log.error("Échec SMS Infobip vers %s : %s", phone_number, exc)
