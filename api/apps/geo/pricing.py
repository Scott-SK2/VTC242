"""Formule de prix (section 8.4)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings

from apps.common.money import d, round_franc, round_up_to

from .models import PricingRule


@dataclass
class PriceBreakdown:
    base_fare: Decimal
    distance_part: Decimal
    time_part: Decimal
    waiting_part: Decimal
    surge_multiplier: Decimal
    raw: Decimal
    minimum_fare: Decimal
    price: Decimal

    def as_dict(self) -> dict:
        return {
            "base_fare": str(self.base_fare),
            "distance_part": str(self.distance_part),
            "time_part": str(self.time_part),
            "waiting_part": str(self.waiting_part),
            "surge_multiplier": str(self.surge_multiplier),
            "raw": str(self.raw),
            "minimum_fare": str(self.minimum_fare),
            "price": str(self.price),
        }


def compute_price(
    rule: PricingRule, distance_m: int, duration_s: int, waiting_seconds: int = 0
) -> PriceBreakdown:
    """Prix final = max(minimum, (base + km×per_km + min×per_min
    + attente payante×per_min_att) × surge),
    arrondi aux 100 F supérieurs."""
    km = Decimal(distance_m) / Decimal(1000)
    minutes = Decimal(duration_s) / Decimal(60)
    paid_wait_s = max(0, waiting_seconds - rule.free_waiting_seconds)
    paid_wait_min = Decimal(paid_wait_s) / Decimal(60)
    distance_part = d(km * rule.per_km)
    time_part = d(minutes * rule.per_minute)
    waiting_part = d(paid_wait_min * rule.waiting_per_minute)
    raw = d((rule.base_fare + distance_part + time_part + waiting_part) * rule.surge_multiplier)
    price = round_up_to(max(rule.minimum_fare, raw), settings.RIDE_ROUNDING_XAF)
    return PriceBreakdown(
        base_fare=d(rule.base_fare),
        distance_part=distance_part,
        time_part=time_part,
        waiting_part=waiting_part,
        surge_multiplier=rule.surge_multiplier,
        raw=raw,
        minimum_fare=d(rule.minimum_fare),
        price=price,
    )


def estimate_range(rule: PricingRule, distance_m: int, duration_s: int) -> tuple[Decimal, Decimal]:
    """Fourchette ± 10 % autour de l'estimation (section 3)."""
    center = compute_price(rule, distance_m, duration_s).price
    spread = Decimal(str(settings.RIDE_ESTIMATE_SPREAD))
    low = round_up_to(max(rule.minimum_fare, center * (1 - spread)), settings.RIDE_ROUNDING_XAF)
    high = round_up_to(center * (1 + spread), settings.RIDE_ROUNDING_XAF)
    return low, high


def commission_for(rule: PricingRule, final_price: Decimal) -> Decimal:
    return round_franc(final_price * rule.commission_rate)
