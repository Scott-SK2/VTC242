from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import Driver


@shared_task(name="drivers.position_watchdog")
def position_watchdog() -> int:
    """Bandeau « position perdue » après 30 s sans position (F-32, A-07) ; le chauffeur est
    retiré de l'index géographique jusqu'à sa prochaine position (plus d'offre dans le vide)."""
    from apps.rides import services as ride_services

    from . import geoindex

    cutoff = timezone.now() - timedelta(seconds=settings.POSITION_LOST_AFTER_S)
    lost = Driver.objects.filter(is_online=True, position_lost_notified=False).filter(
        last_location_at__lt=cutoff
    )
    n = 0
    for driver in lost.select_related("user"):
        ride_services.notify_position_lost(driver)
        geoindex.remove(driver)
        Driver.objects.filter(pk=driver.pk).update(position_lost_notified=True)
        n += 1
    return n
