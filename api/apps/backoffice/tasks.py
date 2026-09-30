from celery import shared_task


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
