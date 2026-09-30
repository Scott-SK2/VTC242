"""Client OSRM (itinéraire) avec repli « vol d'oiseau » quand OSRM est indisponible."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx
from django.conf import settings
from django.core.cache import cache

from apps.common.geo import haversine_m

log = logging.getLogger("vtc242.routing")

URBAN_SPEED_KMH = 22.0
DETOUR_FACTOR = 1.3


@dataclass
class Route:
    distance_m: int
    duration_s: int
    coords: list[list[float]]  # [lng, lat]
    source: str


def _straight(lat1: float, lng1: float, lat2: float, lng2: float) -> Route:
    dist = haversine_m(lat1, lng1, lat2, lng2) * DETOUR_FACTOR
    duration = dist / (URBAN_SPEED_KMH * 1000 / 3600)
    return Route(int(dist), int(duration), [[lng1, lat1], [lng2, lat2]], "straight")


def route(lat1: float, lng1: float, lat2: float, lng2: float) -> Route:
    backend = getattr(settings, "ROUTING_BACKEND", "osrm")
    if backend == "straight" or not settings.OSRM_URL:
        return _straight(lat1, lng1, lat2, lng2)
    key = f"osrm:{lat1:.5f},{lng1:.5f}:{lat2:.5f},{lng2:.5f}"
    cached = cache.get(key)
    if cached:
        return Route(**cached)
    url = (
        f"{settings.OSRM_URL.rstrip('/')}/route/v1/driving/"
        f"{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson"
    )
    try:
        r = httpx.get(url, timeout=6)
        r.raise_for_status()
        data = r.json()
        leg = data["routes"][0]
        result = Route(
            int(leg["distance"]),
            int(leg["duration"]),
            [[c[0], c[1]] for c in leg["geometry"]["coordinates"]],
            "osrm",
        )
        cache.set(key, result.__dict__, timeout=600)
        return result
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        log.warning("OSRM indisponible (%s), repli vol d'oiseau", exc)
        return _straight(lat1, lng1, lat2, lng2)


def eta_seconds(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """ETA rapide sans appel réseau (approche chauffeur)."""
    return _straight(lat1, lng1, lat2, lng2).duration_s
