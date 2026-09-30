"""Émission d'événements WebSocket (section 7.3). Trame : { event, ts, data }."""

from __future__ import annotations

import logging
import time
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

log = logging.getLogger("vtc242.realtime")

ADMIN_GROUP = "backoffice"
SENT: list[dict[str, Any]] = []  # utilisé par les tests (InMemoryChannelLayer)


def user_group(user_id) -> str:
    return f"user.{user_id}"


def ride_group(ride_id) -> str:
    return f"ride.{ride_id}"


def _frame(event: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"type": "ws.send_frame", "event": event, "ts": int(time.time() * 1000), "data": data}


def _send(group: str, event: str, data: dict[str, Any]) -> None:
    SENT.append({"group": group, "event": event, "data": data})
    if len(SENT) > 500:
        del SENT[:-200]
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group, _frame(event, data))
    except Exception as exc:  # pragma: no cover - couche indisponible
        log.warning("Émission WS impossible (%s) : %s", event, exc)


def send_to_user(user_id, event: str, data: dict[str, Any]) -> None:
    _send(user_group(user_id), event, data)


def send_to_ride(ride_id, event: str, data: dict[str, Any]) -> None:
    _send(ride_group(ride_id), event, data)


def send_to_admins(event: str, data: dict[str, Any]) -> None:
    _send(ADMIN_GROUP, event, data)
