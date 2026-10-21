import time

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import HttpResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

WORKER_HEARTBEAT_KEY = "vtc242:worker_heartbeat"


def _redis_status() -> dict:
    """État de Redis sans divulguer l'URL : mémoire utilisée / plafond, politique
    d'éviction, connexions, longueur de la file Celery."""
    import redis

    try:
        r = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=2, socket_connect_timeout=2)
        mem = r.info("memory")
        clients = r.info("clients")
        return {
            "status": "ok",
            "used_memory": mem.get("used_memory_human"),
            "max_memory": mem.get("maxmemory_human") or "illimité",
            "policy": mem.get("maxmemory_policy"),
            "clients": clients.get("connected_clients"),
            "celery_queue": r.llen("celery"),
            "keys": r.dbsize(),
        }
    except redis.exceptions.ResponseError as exc:  # réponse du serveur (ex. OOM), sans hôte
        return {"status": "error", "detail": f"{type(exc).__name__}: {str(exc)[:160]}"}
    except Exception as exc:  # noqa: BLE001 - connexion, délai, DNS…
        return {"status": "error", "detail": type(exc).__name__}


def _worker_status() -> dict:
    try:
        seen = cache.get(WORKER_HEARTBEAT_KEY)
    except Exception as exc:  # noqa: BLE001
        return {"status": "unknown", "detail": type(exc).__name__}
    if not seen:
        return {"status": "missing", "detail": "aucun battement de cœur du worker Celery (2 min)"}
    return {"status": "ok", "seen_s_ago": int(time.time() - float(seen))}


class HealthView(APIView):
    """Sonde de santé. 200 tant que la base répond ; les composants dégradés (Redis, worker)
    sont signalés dans la réponse pour diagnostiquer sans accès aux journaux."""

    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = ()

    def get(self, request):
        components: dict = {}
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT 1")
            components["database"] = {"status": "ok"}
        except Exception as exc:  # noqa: BLE001
            components["database"] = {"status": "error", "detail": type(exc).__name__}
            return Response({"status": "error", "components": components}, status=503)
        components["redis"] = _redis_status()
        components["worker"] = _worker_status()
        degraded = any(c.get("status") != "ok" for c in components.values())
        return Response({"status": "degraded" if degraded else "ok", "components": components})


class MetricsView(APIView):
    """Métriques Prometheus (N-12) : HTTP + métier (mises à jour par apps.backoffice.metrics)."""

    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = ()

    def get(self, request):
        from apps.backoffice.metrics import refresh_business_metrics

        refresh_business_metrics()
        return HttpResponse(generate_latest(), content_type=CONTENT_TYPE_LATEST)
