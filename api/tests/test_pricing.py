from decimal import Decimal

import pytest

from apps.common.geo import distance_to_line_m, haversine_m, sample_line
from apps.geo.pricing import compute_price, estimate_range

pytestmark = pytest.mark.django_db


def test_price_formula_and_rounding(rules):
    rule = rules["standard"]  # base 700, 300/km, 30/min, min 1500, attente gratuite 180 s, 50 F/min
    br = compute_price(rule, 6400, 1080, waiting_seconds=300)
    # 700 + 6.4*300 (1920) + 18*30 (540) + 2 min*50 (100) = 3260 → 3300
    assert br.raw == Decimal("3260.00")
    assert br.price == Decimal("3300.00")
    assert compute_price(rule, 500, 60).price == Decimal("1500.00")  # minimum
    rule.surge_multiplier = Decimal("1.50")
    assert compute_price(rule, 6400, 1080).price == Decimal("4800.00")  # 3160*1.5=4740 → 4800
    low, high = estimate_range(rules["taxi"], 6400, 1080)
    assert low <= high and low % 100 == 0 and high % 100 == 0


def test_geo_helpers():
    assert 1000 < haversine_m(-4.26, 15.28, -4.26, 15.29) < 1200
    coords = [[15.28, -4.26], [15.29, -4.26]]
    samples = sample_line(coords, 50)
    assert 20 <= len(samples) <= 25
    assert distance_to_line_m(-4.26, 15.285, coords) < 5
    assert 400 < distance_to_line_m(-4.2645, 15.285, coords) < 700
