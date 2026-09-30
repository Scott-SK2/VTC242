from django.db import connection
from django.http import HttpResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = ()

    def get(self, request):
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        return Response({"status": "ok"})


class MetricsView(APIView):
    """Métriques Prometheus (N-12) : HTTP + métier (mises à jour par apps.backoffice.metrics)."""

    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = ()

    def get(self, request):
        from apps.backoffice.metrics import refresh_business_metrics

        refresh_business_metrics()
        return HttpResponse(generate_latest(), content_type=CONTENT_TYPE_LATEST)
