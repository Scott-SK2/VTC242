"""Détection de déviation (section 7.5), urgences (F-20), alertes back-office (F-52)."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.common.geo import distance_to_line_m, line_to_coords, point, sample_line
from apps.common.push import send_push
from apps.realtime import events

from .models import Alert, AlertStatus, EmergencyCall, RouteDeviation

log = logging.getLogger("vtc242.safety")


def _route_key(ride_id) -> str:
    return f"ride:route:{ride_id}"


def _hits_key(ride_id) -> str:
    return f"ride:deviation_hits:{ride_id}"


def index_route(ride) -> None:
    """Échantillonne l'itinéraire planifié tous les 50 m et le met en cache."""
    coords = line_to_coords(ride.planned_route) or []
    samples = sample_line(coords, settings.ROUTE_SAMPLE_STEP_M)
    cache.set(_route_key(ride.id), json.dumps(samples), timeout=6 * 3600)
    cache.set(_hits_key(ride.id), 0, timeout=6 * 3600)


def clear_route(ride) -> None:
    cache.delete(_route_key(ride.id))
    cache.delete(_hits_key(ride.id))


def _samples(ride) -> list[list[float]]:
    raw = cache.get(_route_key(ride.id))
    if raw:
        return json.loads(raw)
    coords = line_to_coords(ride.planned_route) or []
    return [list(s) for s in sample_line(coords, settings.ROUTE_SAMPLE_STEP_M)]


def check_position(ride, lat: float, lng: float) -> None:
    zone = ride.zone
    threshold = zone.deviation_threshold_m
    hits_needed = zone.deviation_hits
    samples = _samples(ride)
    if not samples:
        return
    dist = distance_to_line_m(lat, lng, samples)
    if dist <= threshold:
        if int(cache.get(_hits_key(ride.id)) or 0) > 0:
            cache.set(_hits_key(ride.id), 0, timeout=6 * 3600)
        clear_deviation(ride, reason="back_in_corridor")
        return
    if ride.detour_until and ride.detour_until > timezone.now():
        return  # détour signalé : alerte suspendue 5 min (F-38)
    hits = int(cache.get(_hits_key(ride.id)) or 0) + 1
    cache.set(_hits_key(ride.id), hits, timeout=6 * 3600)
    if hits < hits_needed:
        return
    active = (
        RouteDeviation.objects.filter(ride=ride, cleared_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    now = timezone.now()
    if (
        active
        and active.alert_sent_at
        and now - active.alert_sent_at < timedelta(seconds=settings.DEVIATION_ALERT_INTERVAL_S)
    ):
        RouteDeviation.objects.filter(pk=active.pk).update(
            distance_off_m=int(dist), consecutive_count=hits
        )
        return
    dev = RouteDeviation.objects.create(
        ride=ride,
        recorded_location=point(lat, lng),
        distance_off_m=int(dist),
        consecutive_count=hits,
        alert_sent_at=now,
    )
    payload = {
        "ride_id": str(ride.id),
        "distance_off_m": int(dist),
        "emergency_numbers": {"police": zone.emergency_police, "fire": zone.emergency_fire},
    }
    events.send_to_user(ride.passenger_id, "ride.deviation_alert", payload)
    send_push(
        ride.passenger,
        "Itinéraire inhabituel",
        "Votre chauffeur s'écarte de l'itinéraire prévu.",
        payload,
    )
    raise_alert("deviation", ride, {**payload, "deviation_id": str(dev.id)})
    log.warning("Déviation course %s : %d m", ride.id, dist, extra={"ride_id": str(ride.id)})


def clear_deviation(ride, reason: str = "") -> None:
    now = timezone.now()
    open_devs = RouteDeviation.objects.filter(ride=ride, cleared_at__isnull=True)
    if not open_devs.exists():
        return
    open_devs.update(cleared_at=now)
    payload = {"ride_id": str(ride.id), "reason": reason}
    events.send_to_user(ride.passenger_id, "ride.deviation_cleared", payload)
    events.send_to_admins("ride.deviation_cleared", payload)


def raise_alert(type_: str, ride, payload: dict | None = None) -> Alert:
    alert = Alert.objects.create(type=type_, ride=ride, payload=payload or {})
    from apps.backoffice.serializers import AlertSerializer

    events.send_to_admins("admin.alert", AlertSerializer(alert).data)
    return alert


def acknowledge_alert(alert: Alert, actor) -> Alert:
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_by = actor
    alert.acknowledged_at = timezone.now()
    alert.save(update_fields=["status", "acknowledged_by", "acknowledged_at", "updated_at"])
    RouteDeviation.objects.filter(ride=alert.ride, acknowledged_at__isnull=True).update(
        acknowledged_by=actor, acknowledged_at=alert.acknowledged_at
    )
    return alert


def emergency(
    user, ride, number_called: str, lat: float | None, lng: float | None
) -> EmergencyCall:
    loc = point(lat, lng) if lat is not None and lng is not None else None
    call = EmergencyCall.objects.create(
        user=user, ride=ride, number_called=number_called, location=loc
    )
    payload = {
        "ride_id": str(ride.id) if ride else None,
        "by": user.role,
        "number_called": number_called,
        "location": {"lat": lat, "lng": lng} if loc else None,
    }
    raise_alert("emergency", ride, payload)
    if ride:
        from apps.rides.services import log_event

        log_event(ride, "emergency", user, payload)
    return call
