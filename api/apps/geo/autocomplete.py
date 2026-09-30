"""Autocomplétion : points d'intérêt locaux puis Photon (OSM)."""

from __future__ import annotations

import logging

import httpx
from django.conf import settings
from django.contrib.gis.db.models.functions import Distance
from django.db.models import Q

from apps.common.geo import point

from .models import PointOfInterest

log = logging.getLogger("vtc242.geo")


def search(q: str, lat: float | None, lng: float | None, limit: int = 8) -> list[dict]:
    q = q.strip()
    if len(q) < 2:
        return []
    results: list[dict] = []
    qs = PointOfInterest.objects.filter(Q(name__icontains=q) | Q(aliases__icontains=q))
    if lat is not None and lng is not None:
        qs = qs.annotate(dist=Distance("location", point(lat, lng))).order_by("dist")
    for poi in qs[:limit]:
        results.append(
            {
                "label": poi.name,
                "secondary": poi.secondary or poi.zone.city,
                "lat": poi.location.y,
                "lng": poi.location.x,
                "source": "poi",
            }
        )
    if (
        len(results) < limit
        and settings.PHOTON_URL
        and getattr(settings, "ROUTING_BACKEND", "osrm") != "straight"
    ):
        results.extend(_photon(q, lat, lng, limit - len(results)))
    return results


def _photon(q: str, lat, lng, limit: int) -> list[dict]:
    params: dict = {"q": q, "limit": limit, "lang": "fr"}
    if lat is not None and lng is not None:
        params.update({"lat": lat, "lon": lng})
    else:
        params.update({"lat": -4.2634, "lon": 15.2429})
    try:
        r = httpx.get(f"{settings.PHOTON_URL.rstrip('/')}/api/", params=params, timeout=5)
        r.raise_for_status()
        out = []
        for f in r.json().get("features", []):
            p = f.get("properties", {})
            c = f["geometry"]["coordinates"]
            label = p.get("name") or p.get("street") or q
            secondary = ", ".join(
                x for x in (p.get("district"), p.get("city"), p.get("country")) if x
            )
            out.append(
                {
                    "label": label,
                    "secondary": secondary,
                    "lat": c[1],
                    "lng": c[0],
                    "source": "photon",
                }
            )
        return out
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("Photon indisponible : %s", exc)
        return []
