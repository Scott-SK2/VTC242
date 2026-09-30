from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.drivers.models import Driver
from apps.payments.models import (
    PayoutRequest,
    TransactionStatus,
    TransactionType,
    Wallet,
    WalletTransaction,
)
from apps.rides.models import ACTIVE_STATUSES, Ride, RideStatus
from apps.safety.models import Alert, AlertStatus


def dashboard() -> dict:
    """KPI du tableau de bord (F-50)."""
    now = timezone.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = Ride.objects.filter(requested_at__gte=start)
    totals = today.aggregate(
        n=Count("id"),
        cancelled=Count(
            "id",
            filter=Q(
                status__in=(RideStatus.CANCELLED_BY_PASSENGER, RideStatus.CANCELLED_BY_DRIVER)
            ),
        ),
        revenue=Sum("final_price", filter=Q(status=RideStatus.COMPLETED)),
        commission=Sum("commission_amount", filter=Q(status=RideStatus.COMPLETED)),
    )
    drivers = Driver.objects.aggregate(
        online=Count("id", filter=Q(is_online=True)),
        available=Count("id", filter=Q(is_online=True, is_available=True)),
    )
    return {
        "rides_in_progress": Ride.objects.filter(
            status__in=(RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS)
        ).count(),
        "rides_waiting": Ride.objects.filter(
            status__in=(RideStatus.REQUESTED, RideStatus.DISPATCHING)
        ).count(),
        "drivers_online": drivers["online"],
        "drivers_available": drivers["available"],
        "rides_today": totals["n"],
        "revenue_today": str(totals["revenue"] or Decimal("0.00")),
        "commission_today": str(totals["commission"] or Decimal("0.00")),
        "cancellation_rate": round((totals["cancelled"] / totals["n"]) if totals["n"] else 0.0, 3),
        "alerts_open": Alert.objects.filter(status=AlertStatus.OPEN).count(),
        "generated_at": now.isoformat(),
    }


def fleet() -> dict:
    """Carte de la flotte (F-51)."""
    drivers = []
    active_by_driver = {
        r.driver_id: r
        for r in Ride.objects.filter(
            status__in=ACTIVE_STATUSES, driver__isnull=False
        ).select_related("driver")
    }
    for drv in Driver.objects.filter(is_online=True).select_related("user", "active_vehicle"):
        ride = active_by_driver.get(drv.id)
        drivers.append(
            {
                "id": str(drv.id),
                "first_name": drv.user.first_name,
                "last_initial": drv.user.last_initial,
                "status": "busy" if ride else ("available" if drv.is_available else "offline"),
                "location": {
                    "lat": drv.current_location.y,
                    "lng": drv.current_location.x,
                    "heading": drv.heading,
                }
                if drv.current_location
                else None,
                "ride_id": str(ride.id) if ride else None,
                "ride_status": ride.status if ride else None,
                "category": drv.active_vehicle.category if drv.active_vehicle else None,
                "last_location_at": drv.last_location_at.isoformat()
                if drv.last_location_at
                else None,
                "position_lost": drv.position_lost_notified,
            }
        )
    rides = []
    for r in Ride.objects.filter(status__in=ACTIVE_STATUSES).select_related("driver"):
        pos = None
        if r.driver and r.driver.current_location:
            pos = {"lat": r.driver.current_location.y, "lng": r.driver.current_location.x}
        rides.append(
            {
                "id": str(r.id),
                "status": r.status,
                "category": r.category,
                "pickup": {"lat": r.pickup_location.y, "lng": r.pickup_location.x},
                "dropoff": {"lat": r.dropoff_location.y, "lng": r.dropoff_location.x},
                "driver_position": pos,
                "requested_at": r.requested_at.isoformat(),
            }
        )
    return {"drivers": drivers, "rides": rides}


def finance_summary() -> dict:
    now = timezone.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    w = Wallet.objects.aggregate(total=Sum("balance"), reserved=Sum("reserved_balance"))
    deposits = WalletTransaction.objects.filter(
        type=TransactionType.DEPOSIT, status=TransactionStatus.COMPLETED, completed_at__gte=start
    ).aggregate(s=Sum("amount"))["s"]
    commission = WalletTransaction.objects.filter(
        type=TransactionType.COMMISSION, status=TransactionStatus.COMPLETED, created_at__gte=start
    ).aggregate(s=Sum("amount"))["s"]
    payouts_pending = PayoutRequest.objects.filter(
        status__in=("pending", "awaiting_approval", "processing")
    ).aggregate(n=Count("id"), s=Sum("amount"))
    week = now - timedelta(days=7)
    deposits_week = (
        WalletTransaction.objects.filter(
            type=TransactionType.DEPOSIT, status=TransactionStatus.COMPLETED, completed_at__gte=week
        )
        .values("operator")
        .annotate(n=Count("id"), total=Sum("amount"))
    )
    return {
        "wallets_total": str(w["total"] or 0),
        "reserved_total": str(w["reserved"] or 0),
        "payouts_pending": payouts_pending["n"],
        "payouts_pending_amount": str(payouts_pending["s"] or 0),
        "deposits_today": str(deposits or 0),
        "commission_today": str(-(commission or 0)),
        "deposits_week_by_operator": [
            {"operator": d["operator"], "count": d["n"], "total": str(d["total"])}
            for d in deposits_week
        ],
    }
