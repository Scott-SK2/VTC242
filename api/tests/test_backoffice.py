from decimal import Decimal

import pyotp
import pytest
from django.utils import timezone

from apps.backoffice.models import AuditLog
from apps.common import sms
from apps.drivers.models import (
    DocumentStatus,
    DocumentType,
    Driver,
    DriverDocument,
    DriverStatus,
    Vehicle,
)
from apps.geo.models import PricingRule
from apps.payments import services as payments
from apps.rides.models import Dispute, Ride

from .conftest import DROPOFF, PICKUP, client_for, make_user, request_ride

pytestmark = pytest.mark.django_db


def test_driver_validation_flow(admin_api, zone):
    """A-11 : SMS envoyé, chauffeur peut passer en ligne, action dans audit_logs."""
    user = make_user("+242061000050", "driver", first="Nadège")
    driver = Driver.objects.create(user=user, zone=zone)
    dc = client_for(user)
    v = dc.post(
        "/api/v1/drivers/me/vehicles",
        {
            "brand": "Suzuki",
            "model": "Swift",
            "color": "Rouge",
            "license_plate": "BZV 0050",
            "category": "standard",
            "seats": 4,
        },
        format="json",
    )
    assert v.status_code == 201 and v.data["is_active"] is True
    for t in (
        DocumentType.LICENSE,
        DocumentType.REGISTRATION,
        DocumentType.INSURANCE,
        DocumentType.ID_CARD,
        DocumentType.PROFILE_PHOTO,
        DocumentType.VEHICLE_PHOTO,
    ):
        assert (
            dc.post(
                "/api/v1/drivers/me/documents",
                {"type": t, "file_url": "https://files.example.com/y.jpg"},
                format="json",
            ).status_code
            == 201
        )
    me = dc.get("/api/v1/drivers/me")
    assert me.data["can_go_online"] is False and me.data["status"] == "pending"
    assert (
        dc.patch("/api/v1/drivers/me/status", {"is_online": True}, format="json").status_code == 422
    )
    queue = admin_api.get("/api/v1/admin/drivers?status=pending")
    assert queue.status_code == 200 and queue.data["results"][0]["id"] == str(driver.id)
    doc = DriverDocument.objects.filter(driver=driver, type=DocumentType.LICENSE).first()
    rv = admin_api.post(
        f"/api/v1/admin/documents/{doc.id}/review",
        {"status": "approved", "note": ""},
        format="json",
    )
    assert rv.status_code == 200 and rv.data["status"] == "approved"
    r = admin_api.post(f"/api/v1/admin/drivers/{driver.id}/approve")
    assert r.status_code == 200 and r.data["status"] == "approved"
    assert any("validé" in m["body"] for m in sms.OUTBOX)
    assert AuditLog.objects.filter(action="driver.approve", target_id=str(driver.id)).exists()
    on = dc.patch("/api/v1/drivers/me/status", {"is_online": True}, format="json")
    assert on.status_code == 200 and on.data["is_online"] is True
    # suspension → hors ligne + déconnexion à distance
    s = admin_api.post(
        f"/api/v1/admin/drivers/{driver.id}/suspend", {"reason": "Plainte"}, format="json"
    )
    assert s.status_code == 200 and s.data["status"] == "suspended"
    driver.refresh_from_db()
    assert driver.is_online is False
    assert dc.get("/api/v1/drivers/me").status_code == 401


def test_pricing_rule_versioning_with_effective_date(admin_api, api, rules, zone, driver):
    """A-12 : estimations conformes avant / après ; courses en cours conservent leur règle."""
    ride_id = request_ride(api).data["id"]
    old_rule = rules["taxi"]
    before = api.post(
        "/api/v1/rides/estimate", {"pickup": PICKUP, "dropoff": DROPOFF}, format="json"
    )
    before_price = next(e["price_max"] for e in before.data["estimates"] if e["category"] == "taxi")
    future = timezone.now() + timezone.timedelta(hours=1)
    body = {
        "zone_id": str(zone.id),
        "category": "taxi",
        "base_fare": "1000",
        "per_km": "500",
        "per_minute": "50",
        "minimum_fare": "2000",
        "free_waiting_seconds": 180,
        "waiting_per_minute": "50",
        "cancellation_fee": "500",
        "commission_rate": "0.10",
        "surge_multiplier": "1.00",
        "cash_enabled": True,
        "effective_from": future.isoformat(),
    }
    r = admin_api.post("/api/v1/admin/pricing-rules", body, format="json")
    assert r.status_code == 201, r.content
    old_rule.refresh_from_db()
    assert old_rule.effective_to == future.replace(microsecond=future.microsecond)
    still = api.post(
        "/api/v1/rides/estimate", {"pickup": PICKUP, "dropoff": DROPOFF}, format="json"
    )
    assert (
        next(e["price_max"] for e in still.data["estimates"] if e["category"] == "taxi")
        == before_price
    )
    assert (
        str(PricingRule.active_for(zone, "taxi", future + timezone.timedelta(minutes=1)).id)
        == r.data["id"]
    )
    assert PricingRule.active_for(zone, "taxi").id == old_rule.id
    assert str(Ride.objects.get(pk=ride_id).pricing_rule_id) == str(old_rule.id)
    sim = admin_api.post(
        "/api/v1/admin/pricing-rules/simulate",
        {
            "zone_id": str(zone.id),
            "category": "taxi",
            "distance_m": 5000,
            "duration_s": 900,
            "waiting_seconds": 0,
            "at": (future + timezone.timedelta(minutes=1)).isoformat(),
        },
        format="json",
    )
    assert sim.status_code == 200 and Decimal(sim.data["price"]) == Decimal(
        "4300.00"
    )  # 1000+2500+750=4250 → 4300
    # règle utilisée : modification interdite hors surge / effective_to
    assert (
        admin_api.patch(
            f"/api/v1/admin/pricing-rules/{old_rule.id}", {"per_km": "1"}, format="json"
        ).status_code
        == 400
    )


def test_dispute_refund_50_percent(admin_api, api, driver_api, passenger, driver, rules):
    """A-13 : wallet passager crédité, transaction refund, litige resolved."""
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive",
        {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    code = api.get(f"/api/v1/rides/{ride_id}").data["otp_code"]
    driver_api.post(f"/api/v1/rides/{ride_id}/start", {"otp_code": code}, format="json")
    driver_api.post(
        f"/api/v1/rides/{ride_id}/complete",
        {"lat": DROPOFF["lat"], "lng": DROPOFF["lng"]},
        format="json",
    )
    ride = Ride.objects.get(pk=ride_id)
    api.post(f"/api/v1/rides/{ride_id}/dispute", {"reason": "Détour"}, format="json")
    dispute = Dispute.objects.get(ride=ride)
    balance_before = payments.get_wallet(passenger).balance
    half = (ride.final_price / 2).quantize(Decimal("1"))
    lst = admin_api.get("/api/v1/admin/disputes?status=open")
    assert lst.status_code == 200 and lst.data["results"][0]["ride"]["planned_route"]
    r = admin_api.post(
        f"/api/v1/admin/disputes/{dispute.id}/resolve",
        {"refund_amount": str(half), "resolution": "Remboursement 50 %"},
        format="json",
    )
    assert r.status_code == 200 and r.data["status"] == "resolved"
    assert payments.get_wallet(passenger).balance == balance_before + half
    from apps.payments.models import WalletTransaction

    assert WalletTransaction.objects.filter(ride=ride, type="refund", amount=half).exists()
    assert AuditLog.objects.filter(action="dispute.resolve").exists()


def test_roles_and_totp(db, zone):
    finance = make_user("+242060000002", "finance")
    support = make_user("+242060000003", "support")
    fc, sc = client_for(finance), client_for(support)
    assert sc.get("/api/v1/admin/dashboard").status_code == 200
    assert sc.get("/api/v1/admin/finance/summary").status_code == 403
    assert fc.get("/api/v1/admin/finance/summary").status_code == 200
    assert fc.get("/api/v1/admin/audit-logs").status_code == 403
    # activation TOTP → sans validation, 403 totp_required
    setup = fc.post("/api/v1/admin/totp/setup")
    assert setup.status_code == 200
    code = pyotp.TOTP(setup.data["secret"]).now()
    ver = fc.post("/api/v1/admin/totp/verify", {"code": code}, format="json")
    assert ver.status_code == 200
    plain = client_for(finance)
    r = plain.get("/api/v1/admin/finance/summary")
    assert r.status_code == 403 and r.data["code"] == "totp_required"
    plain.credentials(HTTP_AUTHORIZATION=f"Bearer {ver.data['access']}")
    assert plain.get("/api/v1/admin/finance/summary").status_code == 200


def test_dashboard_fleet_alerts_passengers_export(
    admin_api, api, driver_api, driver, passenger, rules
):
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    d = admin_api.get("/api/v1/admin/dashboard")
    assert (
        d.status_code == 200 and d.data["rides_in_progress"] == 1 and d.data["drivers_online"] == 1
    )
    f = admin_api.get("/api/v1/admin/fleet")
    assert f.data["drivers"][0]["status"] == "busy" and f.data["rides"][0]["id"] == ride_id
    detail = admin_api.get(f"/api/v1/admin/rides/{ride_id}")
    assert (
        detail.status_code == 200
        and detail.data["passenger_phone"] == "+242069000001"
        and detail.data["events"]
    )
    api.post(f"/api/v1/rides/{ride_id}/emergency", {"number_called": "117"}, format="json")
    alerts = admin_api.get("/api/v1/admin/alerts?status=open")
    assert alerts.data["results"][0]["type"] == "emergency"
    ack = admin_api.post(f"/api/v1/admin/alerts/{alerts.data['results'][0]['id']}/ack")
    assert ack.data["status"] == "acknowledged"
    p = admin_api.get("/api/v1/admin/passengers?q=Scott")
    assert p.data["results"][0]["rides_count"] == 1
    csv = admin_api.get("/api/v1/admin/finance/export?type=rides")
    assert csv.status_code == 200 and ride_id in csv.content.decode()
    z = admin_api.get("/api/v1/admin/zones")
    assert z.status_code == 200 and z.data[0]["polygon"]["type"] == "MultiPolygon"
    poi = admin_api.post(
        "/api/v1/admin/pois",
        {"name": "Marché Total", "aliases": ["Total"], "lat": -4.2833, "lng": 15.2583},
        format="json",
    )
    assert poi.status_code == 201
    ac = api.get("/api/v1/geo/autocomplete?q=tot&lat=-4.26&lng=15.28")
    assert ac.data["results"][0]["label"] == "Marché Total"
    assert Vehicle.objects.count() == 1 and DocumentStatus.APPROVED and DriverStatus.APPROVED
    b = admin_api.post(
        f"/api/v1/admin/passengers/{passenger.id}/block", {"reason": "fraude"}, format="json"
    )
    assert b.data["is_blocked"] is True
    assert api.get("/api/v1/me").status_code == 401
    assert AuditLog.objects.filter(action="user.block").exists()
