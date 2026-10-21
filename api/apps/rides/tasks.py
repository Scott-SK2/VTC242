from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone


@shared_task(name="rides.dispatch")
def dispatch_ride(ride_id: str) -> None:
    from . import dispatch

    dispatch.offer_next(ride_id)


@shared_task(name="rides.expire_offer")
def expire_offer(offer_id: str) -> bool:
    from . import dispatch

    return dispatch.expire_offer_if_due(offer_id)


@shared_task(name="rides.expire_offers")
def expire_offers() -> int:
    from . import dispatch
    from .models import RideOffer

    n = 0
    for offer in RideOffer.objects.filter(response__isnull=True, expires_at__lt=timezone.now()):
        if dispatch.expire_offer_if_due(offer.id):
            n += 1
    return n


@shared_task(name="rides.dispatch_watchdog")
def dispatch_watchdog() -> int:
    import time

    from django.core.cache import cache

    from apps.common.views import WORKER_HEARTBEAT_KEY

    from . import dispatch

    try:
        cache.set(WORKER_HEARTBEAT_KEY, str(time.time()), 120)  # lu par /health/
    except Exception:  # noqa: BLE001
        pass
    return dispatch.watchdog()


@shared_task(name="rides.purge_old_positions")
def purge_old_positions() -> int:
    from .models import ChatMessage, RidePosition

    cutoff = timezone.now() - timedelta(days=settings.POSITIONS_RETENTION_DAYS)
    deleted, _ = RidePosition.objects.filter(recorded_at__lt=cutoff).delete()
    chat_cutoff = timezone.now() - timedelta(days=settings.CHAT_RETENTION_DAYS)
    ChatMessage.objects.filter(sent_at__lt=chat_cutoff).delete()
    return deleted
