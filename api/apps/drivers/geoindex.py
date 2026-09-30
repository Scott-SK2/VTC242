"""Géo-index des chauffeurs disponibles : Redis GEOSEARCH (section 7.4), repli PostGIS en test."""

from __future__ import annotations

from django.conf import settings
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.measure import D

from apps.common.geo import point

KEY = "drivers:geo:{category}"


def _redis():
    import redis

    return redis.Redis.from_url(settings.REDIS_URL)


def _backend() -> str:
    return getattr(settings, "GEO_INDEX_BACKEND", "redis")


def update_position(driver, lat: float, lng: float) -> None:
    if _backend() != "redis":
        return
    cat = driver.category
    if not cat:
        return
    r = _redis()
    if driver.is_online and driver.is_available:
        r.geoadd(KEY.format(category=cat), (lng, lat, str(driver.id)))
    else:
        r.zrem(KEY.format(category=cat), str(driver.id))


def remove(driver) -> None:
    if _backend() != "redis":
        return
    r = _redis()
    from apps.geo.models import VehicleCategory

    for cat in VehicleCategory.values:
        r.zrem(KEY.format(category=cat), str(driver.id))


def nearby(
    category: str, lat: float, lng: float, radius_m: int, count: int = 10
) -> list[tuple[str, float]]:
    """Renvoie [(driver_id, distance_m)] triés par distance."""
    if _backend() == "redis":
        r = _redis()
        rows = r.geosearch(
            KEY.format(category=category),
            longitude=lng,
            latitude=lat,
            radius=radius_m,
            unit="m",
            sort="ASC",
            count=count,
            withdist=True,
        )
        return [
            (rid.decode() if isinstance(rid, bytes) else rid, float(dist)) for rid, dist in rows
        ]
    from .models import Driver

    p = point(lat, lng)
    qs = (
        Driver.objects.filter(
            is_online=True,
            is_available=True,
            active_vehicle__category=category,
            current_location__distance_lte=(p, D(m=radius_m)),
        )
        .annotate(dist=Distance("current_location", p))
        .order_by("dist")[:count]
    )
    return [(str(drv.id), float(drv.dist.m)) for drv in qs]


def count_nearby(category: str, lat: float, lng: float, radius_m: int = 6000) -> int:
    return len(nearby(category, lat, lng, radius_m, count=50))
