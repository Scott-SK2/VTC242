"""Métriques métier Prometheus (N-12)."""

from __future__ import annotations

from prometheus_client import Gauge

RIDES_BY_STATUS = Gauge("vtc242_rides_active", "Courses actives par statut", ["status"])
DRIVERS_ONLINE = Gauge("vtc242_drivers_online", "Chauffeurs en ligne par zone", ["zone"])
PAYMENTS = Gauge(
    "vtc242_payments_pending", "Transactions en attente par opérateur", ["operator", "type"]
)
MATCHING_S = Gauge("vtc242_matching_seconds_avg", "Durée moyenne de matching (24 h)")


def refresh_business_metrics() -> None:
    from datetime import timedelta

    from django.db.models import Avg, Count, F
    from django.utils import timezone

    from apps.drivers.models import Driver
    from apps.payments.models import WalletTransaction
    from apps.rides.models import ACTIVE_STATUSES, Ride

    for row in (
        Ride.objects.filter(status__in=ACTIVE_STATUSES).values("status").annotate(n=Count("id"))
    ):
        RIDES_BY_STATUS.labels(row["status"]).set(row["n"])
    for row in Driver.objects.filter(is_online=True).values("zone__name").annotate(n=Count("id")):
        DRIVERS_ONLINE.labels(row["zone__name"] or "none").set(row["n"])
    for row in (
        WalletTransaction.objects.filter(status="pending")
        .values("operator", "type")
        .annotate(n=Count("id"))
    ):
        PAYMENTS.labels(row["operator"] or "none", row["type"]).set(row["n"])
    since = timezone.now() - timedelta(hours=24)
    avg = (
        Ride.objects.filter(accepted_at__gte=since)
        .annotate(delay=F("accepted_at") - F("requested_at"))
        .aggregate(a=Avg("delay"))["a"]
    )
    MATCHING_S.set(avg.total_seconds() if avg else 0)
