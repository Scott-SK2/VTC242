#!/usr/bin/env python3
"""Simulateur GPS (section 13) : rejoue une trace GPX (ou une ligne droite) via POST /drivers/me/location.

Usage :
  python scripts/gps_simulator.py --api http://localhost:8000 --token <access JWT chauffeur> \
      [--gpx trace.gpx | --from -4.2650,15.2800 --to -4.2517,15.2531] [--interval 4] [--deviate 400]
"""

from __future__ import annotations

import argparse
import math
import time
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

import httpx


def load_gpx(path: str) -> list[tuple[float, float]]:
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    root = ET.parse(path).getroot()
    pts = root.findall(".//g:trkpt", ns) or root.findall(".//trkpt")
    return [(float(p.get("lat")), float(p.get("lon"))) for p in pts]


def straight(
    a: tuple[float, float], b: tuple[float, float], n: int = 60
) -> list[tuple[float, float]]:
    return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--token", required=True)
    ap.add_argument("--gpx")
    ap.add_argument("--from", dest="src")
    ap.add_argument("--to", dest="dst")
    ap.add_argument("--interval", type=float, default=4.0)
    ap.add_argument(
        "--deviate",
        type=float,
        default=0.0,
        help="décalage latéral en mètres au milieu de la trace",
    )
    args = ap.parse_args()
    if args.gpx:
        pts = load_gpx(args.gpx)
    else:
        a = tuple(map(float, args.src.split(",")))
        b = tuple(map(float, args.dst.split(",")))
        pts = straight(a, b)
    if args.deviate:
        mid = len(pts) // 2
        dlat = args.deviate / 111_320
        for i in range(mid, min(mid + 6, len(pts))):
            pts[i] = (pts[i][0] + dlat, pts[i][1])
    client = httpx.Client(
        base_url=args.api, headers={"Authorization": f"Bearer {args.token}"}, timeout=10
    )
    prev = None
    for lat, lng in pts:
        heading = 0.0
        if prev:
            heading = (math.degrees(math.atan2(lng - prev[1], lat - prev[0])) + 360) % 360
        body = {
            "positions": [
                {
                    "lat": lat,
                    "lng": lng,
                    "heading": heading,
                    "speed_kmh": 30,
                    "accuracy_m": 8,
                    "recorded_at": datetime.now(UTC).isoformat(),
                }
            ]
        }
        r = client.post("/api/v1/drivers/me/location", json=body)
        print(f"{lat:.5f},{lng:.5f} → {r.status_code} {r.text[:60]}")
        prev = (lat, lng)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
