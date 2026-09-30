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
