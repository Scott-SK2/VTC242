from __future__ import annotations

from decimal import Decimal

import pytest
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.authentication import issue_tokens
from apps.accounts.models import User, UserRole
from apps.common import sms
from apps.common.geo import point
from apps.drivers.models import (
    DocumentStatus,
    DocumentType,
    Driver,
    DriverDocument,
    DriverStatus,
    Vehicle,
)
from apps.geo.models import PricingRule, Zone
from apps.payments import services as payments
from apps.realtime import events

BZV = [
    (15.10, -4.10),
    (15.40, -4.10),
    (15.42, -4.20),
    (15.38, -4.36),
    (15.22, -4.40),
    (15.10, -4.32),
    (15.08, -4.20),
    (15.10, -4.10),
]
PICKUP = {"lat": -4.2650, "lng": 15.2800, "address": "Marché Total"}
DROPOFF = {"lat": -4.2517, "lng": 15.2531, "address": "Aéroport Maya-Maya"}


@pytest.fixture(autouse=True)
def _reset_state():
    sms.OUTBOX.clear()
    events.SENT.clear()
    from django.core.cache import cache

    cache.clear()
    yield


@pytest.fixture
def zone(db):
    return Zone.objects.create(
        name="Brazzaville",
        polygon=MultiPolygon(Polygon(BZV), srid=4326),
        cash_enabled=True,
        deviation_threshold_m=300,
        deviation_hits=3,
        min_driver_rating=Decimal("3.5"),
    )


@pytest.fixture
def rules(zone):
    out = {}
    for cat, base, km, mn, minimum, comm, cancel in (
        ("taxi", 500, 250, 25, 1000, "0.10", 500),
        ("standard", 700, 300, 30, 1500, "0.15", 500),
        ("vip", 1500, 500, 50, 3000, "0.15", 1000),
    ):
        out[cat] = PricingRule.objects.create(
            zone=zone,
            category=cat,
            base_fare=base,
            per_km=km,
            per_minute=mn,
            minimum_fare=minimum,
            free_waiting_seconds=180,
            waiting_per_minute=50,
            cancellation_fee=cancel,
            commission_rate=Decimal(comm),
            cash_enabled=cat != "vip",
            effective_from=timezone.now() - timezone.timedelta(days=1),
        )
    return out


def make_user(phone: str, role: str, first="Test", last="User") -> User:
    return User.objects.create_user(phone_number=phone, role=role, first_name=first, last_name=last)


def make_driver(
    phone: str, zone, category="taxi", lat=-4.2660, lng=15.2810, online=True, first="Jean"
) -> Driver:
    user = make_user(phone, UserRole.DRIVER, first=first, last="Mabiala")
    driver = Driver.objects.create(
        user=user,
        status=DriverStatus.APPROVED,
        zone=zone,
        current_location=point(lat, lng),
        last_location_at=timezone.now(),
    )
    vehicle = Vehicle.objects.create(
        driver=driver,
        brand="Toyota",
        model="Corolla",
        color="Vert",
        license_plate=f"BZV {phone[-4:]}",
        taxi_number="T-1",
        category=category,
        is_verified=True,
    )
    driver.active_vehicle = vehicle
    driver.save()
    for t in (
        DocumentType.LICENSE,
        DocumentType.REGISTRATION,
        DocumentType.INSURANCE,
        DocumentType.ID_CARD,
        DocumentType.PROFILE_PHOTO,
        DocumentType.VEHICLE_PHOTO,
        DocumentType.TAXI_CARD,
    ):
        DriverDocument.objects.create(
            driver=driver,
            type=t,
            file_url="https://files.example.com/y.jpg",
            status=DocumentStatus.APPROVED,
        )
    if online:
        driver.is_online = True
        driver.is_available = True
        driver.save()
    return driver


def client_for(user: User, device_id: str | None = None, totp_ok: bool = False) -> APIClient:
    c = APIClient()
    tokens = issue_tokens(user, device_id=device_id or user.active_device_id, totp_ok=totp_ok)
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return c


@pytest.fixture
def passenger(db):
    user = make_user("+242069000001", UserRole.PASSENGER, first="Scott", last="Kula")
    payments.adjust(user, Decimal("10000"), "seed")
    return user


@pytest.fixture
def driver(zone):
    return make_driver("+242061000001", zone)


@pytest.fixture
def admin_user(db):
    return make_user("+242060000001", UserRole.ADMIN, first="Admin", last="VTC")


@pytest.fixture
def api(passenger):
    return client_for(passenger)


@pytest.fixture
def driver_api(driver):
    return client_for(driver.user)


@pytest.fixture
def admin_api(admin_user):
    return client_for(admin_user)


def request_ride(api, category="taxi", payment_method="wallet"):
    est = api.post("/api/v1/rides/estimate", {"pickup": PICKUP, "dropoff": DROPOFF}, format="json")
    assert est.status_code == 200, est.content
    rule_id = next(e["pricing_rule_id"] for e in est.data["estimates"] if e["category"] == category)
    r = api.post(
        "/api/v1/rides",
        {
            "category": category,
            "pricing_rule_id": rule_id,
            "payment_method": payment_method,
            "pickup": PICKUP,
            "dropoff": DROPOFF,
        },
        format="json",
    )
    return r


@pytest.fixture(autouse=True)
def _immediate_on_commit(monkeypatch):
    """Dans les tests (transaction englobante), exécute les callbacks on_commit immédiatement."""
    from django.db import transaction as dj_tx

    monkeypatch.setattr(dj_tx, "on_commit", lambda func, using=None, robust=False: func())
