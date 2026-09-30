from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0.00")
CENT = Decimal("0.01")


def d(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def round_up_to(value: Decimal, step: int) -> Decimal:
    """Arrondi aux `step` francs supérieurs (section 8.4 : 100 F)."""
    return d(math.ceil(Decimal(value) / step) * step)


def round_franc(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP).quantize(CENT)
