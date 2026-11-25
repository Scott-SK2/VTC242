import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

app = Celery("vtc242")
app.config_from_object("django.conf:settings", namespace="CELERY")
# toutes les applications installées (une app oubliée ici = tâches planifiées jamais
# exécutées : « Received unregistered task »)
app.autodiscover_tasks()
