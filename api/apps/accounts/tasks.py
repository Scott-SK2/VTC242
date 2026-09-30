from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import OtpCode


@shared_task(name="accounts.purge_expired_otp")
def purge_expired_otp() -> int:
    cutoff = timezone.now() - timedelta(days=1)
    deleted, _ = OtpCode.objects.filter(created_at__lt=cutoff).delete()
    return deleted
