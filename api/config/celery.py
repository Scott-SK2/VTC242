import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("vtc242")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks(
    [
        "apps.accounts",
        "apps.rides",
        "apps.payments",
        "apps.safety",
        "apps.drivers",
        "apps.backoffice",
    ]
)
