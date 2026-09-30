"""Web Push (VAPID) via pywebpush ; silencieux si non configuré."""

from __future__ import annotations

import json
import logging

from django.conf import settings

log = logging.getLogger("vtc242.push")


def send_push(user, title: str, body: str, data: dict | None = None) -> None:
    from apps.accounts.models import PushSubscription

    subs = list(PushSubscription.objects.filter(user=user))
    if not subs:
        return
    if not settings.VAPID_PRIVATE_KEY:
        log.info("PUSH (non configuré) → %s : %s — %s", user.id, title, body)
        return
    from pywebpush import WebPushException, webpush

    payload = json.dumps({"title": title, "body": body, "data": data or {}})
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL},
                ttl=60,
            )
        except WebPushException as exc:  # pragma: no cover
            log.warning("Push échoué pour %s : %s", user.id, exc)
            if exc.response is not None and exc.response.status_code in (404, 410):
                sub.delete()
