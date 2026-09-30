from __future__ import annotations

import math

from django.contrib.gis.geos import LineString, Point

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def point(lat: float, lng: float) -> Point:
    return Point(float(lng), float(lat), srid=4326)


def point_to_dict(p: Point | None) -> dict | None:
    if p is None:
        return None
    return {"lat": p.y, "lng": p.x}


def line_to_coords(line: LineString | None) -> list[list[float]] | None:
    if line is None:
        return None
    return [[c[0], c[1]] for c in line.coords]


def coords_to_line(coords: list[list[float]] | None) -> LineString | None:
    if not coords or len(coords) < 2:
        return None
    return LineString([(c[0], c[1]) for c in coords], srid=4326)


def sample_line(coords: list[list[float]], step_m: float) -> list[tuple[float, float]]:
    """Échantillonne une polyligne [lng, lat] tous les `step_m` mètres (section 7.5)."""
    if not coords:
        return []
    samples = [(coords[0][0], coords[0][1])]
    carry = 0.0
    for (lng1, lat1), (lng2, lat2) in zip(coords, coords[1:], strict=False):
        seg = haversine_m(lat1, lng1, lat2, lng2)
        if seg == 0:
            continue
        pos = step_m - carry
        while pos <= seg:
            t = pos / seg
            samples.append((lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t))
            pos += step_m
        carry = seg - (pos - step_m)
    last = (coords[-1][0], coords[-1][1])
    if samples[-1] != last:
        samples.append(last)
    return samples


def distance_to_line_m(lat: float, lng: float, coords: list[list[float]]) -> float:
    """Distance minimale d'un point à une polyligne (approximation planaire locale)."""
    if not coords:
        return 0.0
    best = float("inf")
    k = math.cos(math.radians(lat)) * 111_320.0
    px, py = lng * k, lat * 110_540.0
    for (lng1, lat1), (lng2, lat2) in zip(coords, coords[1:], strict=False):
        x1, y1, x2, y2 = lng1 * k, lat1 * 110_540.0, lng2 * k, lat2 * 110_540.0
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            t = 0.0
        else:
            t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        cx, cy = x1 + t * dx, y1 + t * dy
        best = min(best, math.hypot(px - cx, py - cy))
    if len(coords) == 1:
        best = haversine_m(lat, lng, coords[0][1], coords[0][0])
    return best
