from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class AuditLog(TimeStampedModel):
    """Journal d'audit immuable des actions back-office (F-60)."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    action = models.CharField(max_length=60, db_index=True)
    target_type = models.CharField(max_length=40)
    target_id = models.CharField(max_length=64, blank=True)
    diff = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = "audit_logs"
        ordering = ("-created_at",)
