"""Exploitation : sonde de santé, limitation tolérante aux pannes de Redis, liste blanche
des webhooks, purge des chauffeurs injoignables, alertes métier."""

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.safety.models import Alert, AlertType

from .conftest import request_ride

pytestmark = pytest.mark.django_db


def test_health_reports_components(api):
    r = api.get("/health/")
    assert r.status_code == 200
    assert r.data["components"]["database"]["status"] == "ok"
    assert set(r.data["components"]) == {"database", "redis", "worker"}
    assert r.data["status"] in ("ok", "degraded")


def test_throttle_lets_requests_through_when_cache_is_down(monkeypatch, db):
    """Panne de Redis : l'envoi de code répond 202, pas 500."""
    from rest_framework.test import APIClient

    from apps.common import throttling

    class BrokenCache:
        def get(self, *a, **k):
            raise ConnectionError("redis down")

        def set(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(throttling.OtpRequestThrottle, "cache", BrokenCache())
    monkeypatch.setattr(throttling.UserBurstThrottle, "cache", BrokenCache())
    r = APIClient().post(
        "/api/v1/auth/otp/request", {"phone_number": "+242069000077"}, format="json"
    )
    assert r.status_code == 202


def test_webhook_ip_allowlist(monkeypatch, db):
    from rest_framework.test import APIClient

    from apps.payments import views

    calls = []
    monkeypatch.setattr(views.process_webhook, "delay", lambda *a, **k: calls.append(a))
    c = APIClient()
    with override_settings(PAYMENT_WEBHOOK_ALLOWED_IPS=["10.0.0.0/8", "203.0.113.7"]):
        r = c.post(
            "/api/v1/payments/webhooks/mtn",
            data="{}",
            content_type="application/json",
            REMOTE_ADDR="198.51.100.9",
        )
        assert r.status_code == 403 and calls == []
        r = c.post(
            "/api/v1/payments/webhooks/mtn",
            data="{}",
            content_type="application/json",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="10.4.5.6, 127.0.0.1",
        )
        assert r.status_code == 200 and len(calls) == 1
    # liste vide : pas de filtrage
    r = c.post(
        "/api/v1/payments/webhooks/mtn",
        data="{}",
        content_type="application/json",
        REMOTE_ADDR="198.51.100.9",
    )
    assert r.status_code == 200 and len(calls) == 2


def test_position_watchdog_removes_driver_from_geo_index(monkeypatch, driver):
    from apps.drivers import geoindex
    from apps.drivers.models import Driver
    from apps.drivers.tasks import position_watchdog

    removed = []
    monkeypatch.setattr(geoindex, "remove", lambda d: removed.append(d.id))
    Driver.objects.filter(pk=driver.pk).update(
        last_location_at=timezone.now() - timezone.timedelta(seconds=45)
    )
    assert position_watchdog() == 1
    assert removed == [driver.id]
    assert position_watchdog() == 0  # pas de doublon


def test_business_watch_raises_alerts_once(api, rules, zone):
    from apps.backoffice.tasks import business_watch

    # 5 commandes annulées d'affilée, aucun chauffeur en ligne dans la zone
    for _ in range(5):
        r = request_ride(api)
        assert r.status_code == 201, r.data
        c = api.post(f"/api/v1/rides/{r.data['id']}/cancel", {"reason": "test"}, format="json")
        assert c.status_code == 200
    assert business_watch() == 2
    assert Alert.objects.filter(type=AlertType.NO_DRIVERS_ONLINE).count() == 1
    hc = Alert.objects.get(type=AlertType.HIGH_CANCELLATION)
    assert hc.payload["rate_pct"] == 100 and hc.payload["total"] == 5
    assert business_watch() == 0  # pas de doublon tant que l'alerte est ouverte / récente
