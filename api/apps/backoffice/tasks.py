from celery import shared_task

BUSINESS_WATCH_WINDOW_MIN = 30  # fenêtre d'observation des annulations
BUSINESS_WATCH_MIN_RIDES = 5  # nombre minimal de commandes avant de qualifier un taux
BUSINESS_WATCH_CANCEL_RATE = 0.25  # > 25 % d'annulations → alerte
BUSINESS_WATCH_REPEAT_MIN = 60  # pas de doublon d'alerte pendant 60 min


@shared_task(name="backoffice.business_watch")
def business_watch() -> int:
    """Alertes métier (supervision, inspirée des règles Prometheus) :
    - zone sans aucun chauffeur en ligne alors que des passagers commandent ;
    - part des commandes annulées / sans chauffeur > 25 % sur 30 min.
    Les alertes apparaissent dans le back-office (F-52) et sont diffusées aux admins."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.drivers.models import Driver
    from apps.geo.models import Zone
    from apps.rides.models import Ride, RideStatus
    from apps.safety.models import Alert, AlertStatus, AlertType
    from apps.safety.services import raise_alert

    now = timezone.now()
    window = now - timedelta(minutes=BUSINESS_WATCH_WINDOW_MIN)
    repeat_cutoff = now - timedelta(minutes=BUSINESS_WATCH_REPEAT_MIN)
    raised = 0

    def already(type_: str, key: str, value) -> bool:
        return (
            Alert.objects.filter(
                type=type_, created_at__gte=repeat_cutoff, **{f"payload__{key}": value}
            ).exists()
            or Alert.objects.filter(
                type=type_, status=AlertStatus.OPEN, **{f"payload__{key}": value}
            ).exists()
        )

    for zone in Zone.objects.filter(is_active=True):
        demand = Ride.objects.filter(zone=zone, requested_at__gte=window).count()
        if demand == 0:
            continue  # pas de demande : rien à signaler (nuit, zone inactive)
        online = Driver.objects.filter(zone=zone, is_online=True, status="approved").count()
        if online == 0 and not already(AlertType.NO_DRIVERS_ONLINE, "zone_id", str(zone.id)):
            raise_alert(
                AlertType.NO_DRIVERS_ONLINE,
                None,
                {"zone_id": str(zone.id), "zone": zone.name, "requests_30min": demand},
            )
            raised += 1

    recent = Ride.objects.filter(requested_at__gte=window)
    total = recent.count()
    if total >= BUSINESS_WATCH_MIN_RIDES:
        bad = recent.filter(
            status__in=(
                RideStatus.CANCELLED_BY_PASSENGER,
                RideStatus.CANCELLED_BY_DRIVER,
                RideStatus.NO_DRIVER,
            )
        ).count()
        rate = bad / total
        if rate > BUSINESS_WATCH_CANCEL_RATE and not already(
            AlertType.HIGH_CANCELLATION, "scope", "global"
        ):
            raise_alert(
                AlertType.HIGH_CANCELLATION,
                None,
                {
                    "scope": "global",
                    "rate_pct": round(rate * 100),
                    "cancelled": bad,
                    "total": total,
                    "window_min": BUSINESS_WATCH_WINDOW_MIN,
                },
            )
            raised += 1
    return raised


@shared_task(name="backoffice.broadcast_dashboard")
def broadcast_dashboard() -> None:
    """admin.dashboard + admin.fleet toutes les 5 s vers le back-office (section 7.3)."""
    from apps.realtime import events
    from apps.safety.models import Alert, AlertStatus

    from . import services
    from .serializers import AlertSerializer

    alerts = AlertSerializer(
        Alert.objects.filter(status=AlertStatus.OPEN).select_related(
            "ride__driver__user", "ride__passenger"
        )[:20],
        many=True,
    ).data
    events.send_to_admins("admin.dashboard", {"kpis": services.dashboard(), "alerts": alerts})
    events.send_to_admins("admin.fleet", services.fleet())
