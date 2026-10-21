"""Autocomplétion : points d'intérêt locaux (tolérants aux fautes) puis Photon (OSM)."""

from __future__ import annotations

import logging
import unicodedata
from difflib import SequenceMatcher

import httpx
from django.conf import settings

from apps.common.geo import haversine_m

from .models import PointOfInterest

log = logging.getLogger("vtc242.geo")

USER_AGENT = "VTC242/1.0 (+https://vtc242.cg; autocomplete)"


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch)).strip()


def _score(q: str, candidate: str) -> float:
    """Score 0–1 : préfixe ou sous-chaîne exacte en tête, puis similarité (fautes de frappe)."""
    cand = _norm(candidate)
    if not cand:
        return 0.0
    if cand.startswith(q):
        return 1.0
    if q in cand:
        return 0.95
    q_tokens = q.split()
    c_tokens = cand.split()
    if q_tokens and all(
        any(SequenceMatcher(None, qt, ct).ratio() >= 0.8 for ct in c_tokens) for qt in q_tokens
    ):
        return 0.85
    ratio = SequenceMatcher(None, q, cand).ratio()
    partial = max(
        (
            SequenceMatcher(None, q, cand[i : i + len(q) + 2]).ratio()
            for i in range(0, max(1, len(cand) - len(q) + 1), 2)
        ),
        default=0,
    )
    return max(ratio, partial)


def search(q: str, lat: float | None, lng: float | None, limit: int = 8) -> list[dict]:
    q = q.strip()
    if len(q) < 2:
        return []
    nq = _norm(q)
    scored: list[tuple[float, float, PointOfInterest]] = []
    for poi in PointOfInterest.objects.select_related("zone").all()[:2000]:
        best = (
            max(_score(nq, poi.name), *(_score(nq, a) for a in poi.aliases))
            if poi.aliases
            else _score(nq, poi.name)
        )
        if best < 0.6:
            continue
        dist = (
            haversine_m(lat, lng, poi.location.y, poi.location.x)
            if lat is not None and lng is not None
            else 0.0
        )
        scored.append((best, dist, poi))
    scored.sort(key=lambda t: (-round(t[0], 2), t[1]))
    results: list[dict] = [
        {
            "label": poi.name,
            "secondary": poi.secondary or poi.zone.city,
            "lat": poi.location.y,
            "lng": poi.location.x,
            "source": "poi",
        }
        for _, _, poi in scored[:limit]
    ]
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
        r = httpx.get(
            f"{settings.PHOTON_URL.rstrip('/')}/api/",
            params=params,
            timeout=6,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if r.status_code != 200:
            log.warning("Photon HTTP %s pour %r : %s", r.status_code, q, r.text[:120])
            return []
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
        log.warning("Photon indisponible pour %r : %s", q, exc)
        return []
