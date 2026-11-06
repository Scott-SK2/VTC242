import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common import sms

pytestmark = pytest.mark.django_db


def test_otp_signup_and_login_flow():
    c = APIClient()
    r = c.post("/api/v1/auth/otp/request", {"phone_number": "06 123 45 67"}, format="json")
    assert r.status_code == 202
    code = r.data["debug_code"]
    assert len(code) == 6
    assert sms.OUTBOX and code in sms.OUTBOX[-1]["body"]
    r = c.post(
        "/api/v1/auth/otp/verify", {"phone_number": "061234567", "code": code}, format="json"
    )
    assert r.status_code == 200, r.content
    assert r.data["created"] is True
    assert r.data["user"]["phone_number"] == "+242061234567"
    assert r.data["user"]["role"] == "passenger"
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    me = c.get("/api/v1/me")
    assert me.status_code == 200 and me.data["role"] == "passenger"
    # refresh rotatif
    rf = c.post("/api/v1/auth/token/refresh", {"refresh": r.data["refresh"]}, format="json")
    assert rf.status_code == 200 and rf.data["refresh"] != r.data["refresh"]
    again = c.post("/api/v1/auth/token/refresh", {"refresh": r.data["refresh"]}, format="json")
    assert again.status_code == 401


def test_three_wrong_codes_lock_for_15_minutes():
    """A-01 : 3 mauvais codes bloquent 15 min."""
    c = APIClient()
    c.post("/api/v1/auth/otp/request", {"phone_number": "+242061234567"}, format="json")
    for i in range(2):
        r = c.post(
            "/api/v1/auth/otp/verify",
            {"phone_number": "+242061234567", "code": "000000"},
            format="json",
        )
        assert r.status_code == 400 and r.data["code"] == "invalid_otp"
        assert r.data["details"]["attempts_left"] == 2 - i
    r = c.post(
        "/api/v1/auth/otp/verify",
        {"phone_number": "+242061234567", "code": "000000"},
        format="json",
    )
    assert r.status_code == 423 and r.data["code"] == "otp_locked"
    r = c.post("/api/v1/auth/otp/request", {"phone_number": "+242061234567"}, format="json")
    assert r.status_code == 423


def test_otp_rate_limit_three_per_15_min():
    c = APIClient()
    for _ in range(3):
        assert (
            c.post(
                "/api/v1/auth/otp/request", {"phone_number": "+242061234568"}, format="json"
            ).status_code
            == 202
        )
    r = c.post("/api/v1/auth/otp/request", {"phone_number": "+242061234568"}, format="json")
    assert r.status_code == 429


def test_driver_single_device(zone):
    c = APIClient()
    r = c.post("/api/v1/auth/otp/request", {"phone_number": "+242061000099"}, format="json")
    code = r.data["debug_code"]
    first = c.post(
        "/api/v1/auth/otp/verify",
        {"phone_number": "+242061000099", "code": code, "role": "driver", "device_id": "phone-A"},
        format="json",
    )
    assert first.status_code == 200 and first.data["user"]["role"] == "driver"
    r = c.post("/api/v1/auth/otp/request", {"phone_number": "+242061000099"}, format="json")
    second = c.post(
        "/api/v1/auth/otp/verify",
        {"phone_number": "+242061000099", "code": r.data["debug_code"], "device_id": "phone-B"},
        format="json",
    )
    assert second.status_code == 200
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {first.data['access']}")
    assert c.get("/api/v1/me").status_code == 401
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {second.data['access']}")
    assert c.get("/api/v1/me").status_code == 200


def test_delete_account_anonymizes(passenger, api):
    """A-17 : données anonymisées, connexion impossible."""
    r = api.delete("/api/v1/me")
    assert r.status_code == 204
    passenger.refresh_from_db()
    assert passenger.phone_number.startswith("deleted:")
    assert passenger.is_active is False and passenger.deleted_at is not None
    assert User.objects.filter(pk=passenger.pk).exists()
    assert api.get("/api/v1/me").status_code == 401


def _login(c, phone, role=None, device=None):
    r = c.post("/api/v1/auth/otp/request", {"phone_number": phone}, format="json")
    body = {"phone_number": phone, "code": r.data["debug_code"]}
    if role:
        body["role"] = role
    if device:
        body["device_id"] = device
    return c.post("/api/v1/auth/otp/verify", body, format="json")


def test_one_account_can_be_passenger_and_driver(db, zone):
    """Double profil : un même compte bascule entre passager et chauffeur (même wallet)."""
    from apps.drivers.models import Driver

    c = APIClient()
    r = _login(c, "+242069000088")
    assert r.data["user"]["role"] == "passenger" and r.data["user"]["has_driver_profile"] is False
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    s = c.post("/api/v1/me/mode", {"role": "driver", "device_id": "tel-1"}, format="json")
    assert s.status_code == 200 and s.data["user"]["role"] == "driver"
    assert s.data["user"]["has_driver_profile"] is True
    user = User.objects.get(phone_number="+242069000088")
    assert Driver.objects.filter(user=user, status="pending").exists()
    # l'ancien jeton (mode passager) n'ouvre plus le mode chauffeur ; le nouveau oui
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {s.data['access']}")
    assert c.get("/api/v1/drivers/me").status_code == 200
    back = c.post("/api/v1/me/mode", {"role": "passenger"}, format="json")
    assert back.status_code == 200 and back.data["user"]["role"] == "passenger"
    # connexion en choisissant l'autre mode : bascule directe, plus de blocage F-05
    r = _login(APIClient(), "+242069000088", role="driver", device="tel-2")
    assert r.data["user"]["role"] == "driver" and r.data["mode_note"] is None
    # le personnel ne peut pas basculer
    staff = User.objects.create_user(phone_number="+242060000077", role="support")
    from .conftest import client_for

    assert (
        client_for(staff).post("/api/v1/me/mode", {"role": "driver"}, format="json").status_code
        == 403
    )


def test_mode_switch_blocked_during_active_ride(api, passenger, rules):
    from .conftest import request_ride

    assert request_ride(api).status_code == 201
    r = api.post("/api/v1/me/mode", {"role": "driver"}, format="json")
    assert r.status_code == 409 and r.data["code"] == "mode_switch_blocked"
    # à la connexion : on reste passager, avec une explication
    r = _login(APIClient(), passenger.phone_number, role="driver")
    assert r.data["user"]["role"] == "passenger" and r.data["mode_note"]


def test_leaving_driver_mode_goes_offline_and_never_self_dispatch(zone, rules):
    from decimal import Decimal

    from apps.drivers.models import Driver
    from apps.payments import services as payments
    from apps.rides.models import Ride, RideOffer

    from .conftest import client_for, make_driver, request_ride

    driver = make_driver("+242061000088", zone)  # en ligne
    user = driver.user
    c = client_for(user, device_id=None)
    s = c.post("/api/v1/me/mode", {"role": "passenger"}, format="json")
    assert s.status_code == 200
    driver.refresh_from_db()
    assert driver.is_online is False and driver.is_available is False
    # même s'il était remis en ligne, il ne recevrait pas sa propre commande
    Driver.objects.filter(pk=driver.pk).update(is_online=True, is_available=True)
    user.refresh_from_db()
    payments.adjust(user, Decimal("20000"), "test")
    pc = client_for(user)
    r = request_ride(pc)
    assert r.status_code == 201, r.data
    assert not RideOffer.objects.filter(
        ride=Ride.objects.get(pk=r.data["id"]), driver=driver
    ).exists()
