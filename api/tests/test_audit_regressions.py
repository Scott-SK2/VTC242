"""Non-régression de l'audit de novembre 2026 : argent, retraits, locations, dispatch."""

import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.common.exceptions import Unprocessable
from apps.payments import services as payments
from apps.payments.models import PayoutRequest, WalletTransaction
from apps.payments.providers.base import CollectionResult
from apps.rides import services as rs
from apps.rides.models import Ride

from .conftest import DROPOFF, PICKUP, client_for, make_driver, make_user, request_ride


def _to_in_progress(api, driver, payment_method="wallet"):
    r = request_ride(api, payment_method=payment_method)
    assert r.status_code == 201, r.content
    ride_id = r.data["id"]
    rs.accept(ride_id, driver)
    rs.arrive(ride_id, driver, PICKUP["lat"], PICKUP["lng"])
    rs.start(ride_id, driver, Ride.objects.get(pk=ride_id).otp_code_plain)
    return ride_id


def _long_ride(ride_id, minutes=90):
    Ride.objects.filter(pk=ride_id).update(started_at=timezone.now() - timedelta(minutes=minutes))


# --- règlement ---------------------------------------------------------------------------
def test_complete_does_not_touch_other_reservations(api, passenger, driver, rules):
    """Prix final > réservation et le reste du solde réservé ailleurs (covoiturage) :
    la course se termine, plafonnée, sans entamer l'autre réservation."""
    ride_id = _to_in_progress(api, driver)
    other = payments.get_wallet(passenger).available
    payments.reserve(passenger, other, what="covoiturage")
    _long_ride(ride_id)
    rs.complete(ride_id, driver, DROPOFF["lat"], DROPOFF["lng"])
    ride = Ride.objects.get(pk=ride_id)
    w = payments.get_wallet(passenger)
    assert ride.status == "completed" and ride.price_capped
    assert w.reserved_balance == other and w.balance >= w.reserved_balance
    charged, _ = payments.ride_charged_and_refunded(ride)
    assert charged == ride.reserved_amount
    # commission au prorata de l'encaissé, gain = encaissé − commission
    assert ride.commission_amount < rs.commission_for(ride.pricing_rule, ride.final_price)
    assert ride.driver_earning == charged - ride.commission_amount


def test_cash_commission_with_driver_reservation(api, passenger, driver, rules):
    """Chauffeur à double profil avec une réservation : la commission espèces passe
    (dette), la course n'échoue pas."""
    payments.adjust(driver.user, Decimal("2000"), "seed")
    payments.reserve(driver.user, Decimal("2000"))
    ride_id = _to_in_progress(api, driver, payment_method="cash")
    rs.complete(ride_id, driver, DROPOFF["lat"], DROPOFF["lng"])
    assert Ride.objects.get(pk=ride_id).status == "completed"
    w = payments.get_wallet(driver.user)
    assert w.available < 0  # dette visible, aucune nouvelle réservation possible


# --- remboursements ------------------------------------------------------------------------
def test_dispute_refund_capped_by_previous_refund(api, passenger, driver, rules, admin_user):
    ride_id = _to_in_progress(api, driver)
    rs.complete(ride_id, driver, DROPOFF["lat"], DROPOFF["lng"])
    ride = Ride.objects.get(pk=ride_id)
    charged, _ = payments.ride_charged_and_refunded(ride)
    dispute = rs.open_dispute(ride_id, passenger, "trop cher")
    payments.refund_ride(ride, charged, admin_user, "geste")
    with pytest.raises(Unprocessable):
        rs.resolve_dispute(dispute, admin_user, ride.final_price, "ok")
    assert payments.ride_charged_and_refunded(ride) == (charged, charged)


def test_dispute_refund_capped_by_capped_charge(passenger, driver, rules, admin_user):
    api = client_for(passenger)
    ride_id = _to_in_progress(api, driver)
    payments.adjust(passenger, -payments.get_wallet(passenger).available, "drain")
    _long_ride(ride_id)
    rs.complete(ride_id, driver, DROPOFF["lat"], DROPOFF["lng"])
    ride = Ride.objects.get(pk=ride_id)
    charged, _ = payments.ride_charged_and_refunded(ride)
    assert ride.price_capped and charged < ride.final_price
    dispute = rs.open_dispute(ride_id, passenger, "trop cher")
    with pytest.raises(Unprocessable):
        rs.resolve_dispute(dispute, admin_user, ride.final_price, "ok")
    rs.resolve_dispute(dispute, admin_user, charged, "ok")
    assert payments.ride_charged_and_refunded(ride) == (charged, charged)


# --- retraits Mobile Money ----------------------------------------------------------------
def test_payout_not_recredited_on_timeout_and_late_success_kept(driver):
    payments.adjust(driver.user, Decimal("20000"), "seed")
    tx = payments.payout(driver, Decimal("5002"), "mtn", "+242061000001")  # sandbox : sans réponse
    tx.refresh_from_db()
    assert tx.status == "pending" and tx.external_reference
    WalletTransaction.objects.filter(pk=tx.pk).update(
        created_at=timezone.now() - timedelta(minutes=16)
    )
    payments.poll_pending()
    tx.refresh_from_db()
    # toujours en attente, argent toujours débité, la finance est alertée
    assert tx.status == "pending"
    assert payments.get_wallet(driver.user).balance == Decimal("14998")
    assert tx.provider_payload.get("review_alerted")
    # l'opérateur confirme ensuite : le retrait est bien clos comme versé
    cache.set(f"sandbox:tx:{tx.external_reference}", "completed", 3600)
    payments.handle_webhook(
        "mtn", {}, json.dumps({"reference": tx.external_reference, "status": "completed"}).encode()
    )
    tx.refresh_from_db()
    assert tx.status == "completed"
    assert payments.get_wallet(driver.user).balance == Decimal("14998")


def test_initiate_refusal_marks_request_failed(driver, monkeypatch):
    class Refuser:
        def initiate_disbursement(self, amount, phone, key):
            return CollectionResult("REF-X", "failed", {})

    monkeypatch.setattr(payments, "get_provider", lambda op: Refuser())
    payments.adjust(driver.user, Decimal("20000"), "seed")
    tx = payments.payout(driver, Decimal("5000"), "mtn", "+242061000001")
    tx.refresh_from_db()
    req = PayoutRequest.objects.get(transaction=tx)
    assert tx.status == "failed" and req.status == "failed"
    assert payments.get_wallet(driver.user).balance == Decimal("20000")


def test_reject_payout_keeps_rejected_status(driver, admin_user):
    payments.adjust(driver.user, Decimal("200000"), "seed")
    tx = payments.payout(driver, Decimal("150000"), "mtn", "+242061000001")
    req = PayoutRequest.objects.get(transaction=tx)
    assert req.status == "awaiting_approval"
    payments.reject_payout(req, admin_user, "doute")
    req.refresh_from_db()
    assert req.status == "rejected"
    assert payments.get_wallet(driver.user).balance == Decimal("200000")


def test_reject_refused_once_sent_to_operator(driver, admin_user):
    payments.adjust(driver.user, Decimal("20000"), "seed")
    tx = payments.payout(driver, Decimal("5002"), "mtn", "+242061000001")
    req = PayoutRequest.objects.get(transaction=tx)
    assert req.status == "processing"
    with pytest.raises(Unprocessable):
        payments.reject_payout(req, admin_user, "trop tard")


# --- dispatch ------------------------------------------------------------------------------
def test_dispatch_looks_beyond_ten_nearest(api, passenger, rules, zone):
    from apps.drivers.models import Driver

    near = [make_driver(f"+2420610002{i:02d}", zone, lat=-4.2665 + i * 0.0001) for i in range(10)]
    Driver.objects.filter(pk__in=[d.pk for d in near]).update(
        paused_until=timezone.now() + timedelta(hours=1)
    )
    far = make_driver("+242061000299", zone, lat=-4.2600)
    r = request_ride(api)
    assert r.status_code == 201
    ride = Ride.objects.get(pk=r.data["id"])
    assert ride.offers.filter(driver=far).exists()


def test_accept_refused_when_driver_already_busy(api, passenger, driver, rules):
    from apps.rides.models import RideOffer

    ride_id = _to_in_progress(api, driver)
    p2 = make_user("+242069000099", "passenger")
    payments.adjust(p2, Decimal("10000"), "seed")
    other = request_ride(client_for(p2))
    assert other.status_code == 201
    # offre ouverte sur une 2e course alors que le chauffeur est déjà en course
    RideOffer.objects.create(
        ride_id=other.data["id"],
        driver=driver,
        expires_at=timezone.now() + timedelta(seconds=30),
        distance_m=100,
        estimated_earning=Decimal("1000"),
    )
    r = client_for(driver.user).post(f"/api/v1/rides/{other.data['id']}/accept")
    assert r.status_code == 409 and r.data["code"] == "driver_busy"
    assert Ride.objects.get(pk=ride_id).status == "in_progress"


# --- sécurité ------------------------------------------------------------------------------
def test_forged_webhook_does_not_credit_deposit(api, passenger):
    before = payments.get_wallet(passenger).balance
    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "5002", "operator": "mtn", "phone_number": "+242069000001"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="client-chosen-key",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    assert tx.external_reference and tx.external_reference != "client-chosen-key"
    # l'opérateur n'a rien confirmé : un webhook « réussi » forgé n'a aucun effet
    payments.handle_webhook(
        "mtn", {}, json.dumps({"reference": tx.external_reference, "status": "completed"}).encode()
    )
    tx.refresh_from_db()
    assert tx.status == "pending" and payments.get_wallet(passenger).balance == before


def test_support_cannot_block_staff(db, admin_user):
    from apps.accounts.models import UserRole

    support = client_for(make_user("+242060000009", UserRole.SUPPORT))
    r = support.post(
        f"/api/v1/admin/passengers/{admin_user.id}/block", {"reason": "test"}, format="json"
    )
    assert r.status_code == 404
    admin_user.refresh_from_db()
    assert admin_user.is_active


def test_same_mode_switch_refused(api):
    r = api.post("/api/v1/me/mode", {"role": "passenger"}, format="json")
    assert r.status_code == 409 and r.data["code"] == "same_mode"


def test_offered_driver_cannot_read_chat(api, passenger, driver, rules):
    r = request_ride(api)
    ride_id = r.data["id"]
    assert Ride.objects.get(pk=ride_id).offers.filter(driver=driver).exists()
    dc = client_for(driver.user)
    assert dc.get(f"/api/v1/rides/{ride_id}").status_code == 200  # détail de l'offre
    assert dc.get(f"/api/v1/rides/{ride_id}/messages").status_code == 404


def test_push_endpoint_must_be_a_browser_push_service(api):
    keys = {"p256dh": "x", "auth": "y"}
    bad = api.post(
        "/api/v1/me/push-subscriptions",
        {"endpoint": "http://127.0.0.1:6379/", "keys": keys},
        format="json",
    )
    assert bad.status_code == 400
    ok = api.post(
        "/api/v1/me/push-subscriptions",
        {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": keys},
        format="json",
    )
    assert ok.status_code == 201
    assert (
        api.delete(
            "/api/v1/me/push-subscriptions",
            {"endpoint": "https://fcm.googleapis.com/fcm/send/abc"},
            format="json",
        ).status_code
        == 204
    )


def test_account_deletion_blocked_during_ride(api, passenger, driver, rules):
    request_ride(api)
    r = api.delete("/api/v1/me")
    assert r.status_code == 409 and r.data["code"] == "deletion_blocked"
    passenger.refresh_from_db()
    assert passenger.is_active


def test_staff_totp_expires_after_admin_session(admin_user, monkeypatch):
    import time as _time

    from apps.accounts.authentication import issue_tokens

    tokens = issue_tokens(admin_user, totp_ok=True, totp_at=int(_time.time()) - 9 * 3600)
    r = client_for(admin_user).post(
        "/api/v1/auth/token/refresh", {"refresh": tokens["refresh"]}, format="json"
    )
    assert r.status_code == 200
    c = client_for(admin_user)
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    dash = c.get("/api/v1/admin/dashboard")
    assert dash.status_code == 403 and dash.data["code"] == "totp_required"
