from decimal import Decimal

import pytest

from apps.payments import services as payments
from apps.payments.models import PayoutRequest, WalletTransaction
from apps.payments.tasks import sandbox_deliver_webhook
from apps.realtime import events

pytestmark = pytest.mark.django_db


def test_deposit_sandbox_success_and_duplicate_webhook_ignored(api, passenger):
    """A-09 : completed via webhook ; aucun double crédit sur webhook rejoué."""
    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "5000", "operator": "mtn", "phone_number": "+242069000001"},
        format="json",
    )
    assert r.status_code == 202 and r.data["status"] == "pending"
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    assert tx.external_reference and tx.external_reference.startswith("SBX-MTN-")
    payments.handle_webhook(
        "mtn", {}, f'{{"reference": "{tx.external_reference}", "status": "completed"}}'.encode()
    )
    tx.refresh_from_db()
    assert tx.status == "completed"
    assert payments.get_wallet(passenger).balance == Decimal("15000")
    payments.handle_webhook(
        "mtn", {}, f'{{"reference": "{tx.external_reference}", "status": "completed"}}'.encode()
    )
    assert payments.get_wallet(passenger).balance == Decimal("15000")
    assert any(e["event"] == "wallet.updated" for e in events.SENT)


def test_deposit_sandbox_failed_and_expired(api, passenger):
    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "5001", "operator": "airtel", "phone_number": "+242069000001"},
        format="json",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    sandbox_deliver_webhook("airtel", tx.external_reference, "failed")
    tx.refresh_from_db()
    assert tx.status == "failed"
    assert payments.get_wallet(passenger).balance == Decimal("10000")

    # montant en 2 : aucun webhook → polling → expiré après 15 min
    from django.utils import timezone

    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "5002", "operator": "mtn", "phone_number": "+242069000001"},
        format="json",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    WalletTransaction.objects.filter(pk=tx.pk).update(
        created_at=timezone.now() - timezone.timedelta(minutes=16)
    )
    payments.poll_pending()
    tx.refresh_from_db()
    assert tx.status == "expired"
    assert payments.get_wallet(passenger).balance == Decimal("10000")


def test_deposit_polling_completes_without_webhook(api, passenger):
    from django.utils import timezone

    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "3000", "operator": "mtn", "phone_number": "+242069000001"},
        format="json",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    WalletTransaction.objects.filter(pk=tx.pk).update(
        status="pending", created_at=timezone.now() - timezone.timedelta(seconds=120)
    )
    payments.poll_pending()
    tx.refresh_from_db()
    assert tx.status == "completed"


def test_deposit_idempotency(api, passenger):
    key = "11111111-1111-1111-1111-111111111111"
    body = {"amount": "2000", "operator": "mtn", "phone_number": "+242069000001"}
    r1 = api.post("/api/v1/wallet/deposit", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    r2 = api.post("/api/v1/wallet/deposit", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r1.data["id"] == r2.data["id"]
    assert WalletTransaction.objects.filter(type="deposit").count() == 1


def test_payout_failure_recredits(driver_api, driver):
    """A-10 : échec opérateur → recrédit automatique et notification."""
    payments.adjust(driver.user, Decimal("20000"), "gains")
    r = driver_api.post(
        "/api/v1/wallet/payout",
        {"amount": "10001", "operator": "mtn", "phone_number": "+242061000001"},
        format="json",
    )
    assert r.status_code == 202, r.content
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    assert payments.get_wallet(driver.user).balance == Decimal("9999")  # débit immédiat
    sandbox_deliver_webhook("mtn", tx.external_reference, "failed")
    tx.refresh_from_db()
    assert tx.status == "failed"
    assert payments.get_wallet(driver.user).balance == Decimal("20000")
    assert PayoutRequest.objects.get(transaction=tx).status == "failed"


def test_payout_success_and_limits(driver_api, driver):
    payments.adjust(driver.user, Decimal("20000"), "gains")
    low = driver_api.post(
        "/api/v1/wallet/payout",
        {"amount": "500", "operator": "mtn", "phone_number": "+242061000001"},
        format="json",
    )
    assert low.status_code == 422 and low.data["code"] == "below_minimum"
    r = driver_api.post(
        "/api/v1/wallet/payout",
        {"amount": "5000", "operator": "airtel", "phone_number": "+242061000001"},
        format="json",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    sandbox_deliver_webhook("airtel", tx.external_reference, "completed")
    tx.refresh_from_db()
    assert tx.status == "completed" and payments.get_wallet(driver.user).balance == Decimal("15000")
    assert PayoutRequest.objects.get(transaction=tx).status == "completed"
    w = driver_api.get("/api/v1/wallet")
    assert w.status_code == 200 and Decimal(w.data["available"]) == Decimal("15000")
    cap = driver_api.post(
        "/api/v1/wallet/payout",
        {"amount": "199000", "operator": "mtn", "phone_number": "+242061000001"},
        format="json",
    )
    assert cap.status_code == 422 and cap.data["code"] == "daily_cap"


def test_manual_approval_above_threshold(driver_api, driver, admin_user):
    from .conftest import client_for

    payments.adjust(driver.user, Decimal("150000"), "gains")
    r = driver_api.post(
        "/api/v1/wallet/payout",
        {"amount": "120000", "operator": "mtn", "phone_number": "+242061000001"},
        format="json",
    )
    req = PayoutRequest.objects.get(transaction_id=r.data["id"])
    assert req.status == "awaiting_approval"
    admin = client_for(admin_user)
    a = admin.post(f"/api/v1/admin/finance/payouts/{req.id}/approve")
    assert a.status_code == 200 and a.data["status"] in ("pending", "processing")
    req.refresh_from_db()
    assert req.transaction.external_reference


def test_recompute_balances_detects_mismatch(passenger):
    from apps.payments.models import Wallet

    assert payments.recompute_balances() == []
    Wallet.objects.filter(user=passenger).update(balance=Decimal("999"))
    mismatches = payments.recompute_balances()
    assert len(mismatches) == 1 and mismatches[0]["expected"] == "10000.00"


def test_reconciliation_import(api, passenger, admin_api):
    r = api.post(
        "/api/v1/wallet/deposit",
        {"amount": "5000", "operator": "mtn", "phone_number": "+242069000001"},
        format="json",
    )
    tx = WalletTransaction.objects.get(pk=r.data["id"])
    sandbox_deliver_webhook("mtn", tx.external_reference, "completed")
    csv = (
        "operator,external_reference,amount,status\n"
        f"mtn,{tx.external_reference},5000,SUCCESS\nmtn,UNKNOWN-1,1000,SUCCESS\n"
    )
    from django.core.files.uploadedfile import SimpleUploadedFile

    f = SimpleUploadedFile("mtn.csv", csv.encode(), content_type="text/csv")
    rep = admin_api.post(
        "/api/v1/admin/finance/reconciliation/import",
        {"file": f, "operator": "mtn"},
        format="multipart",
    )
    assert rep.status_code == 200, rep.content
    assert rep.data["matched"] == 1
    assert any(m["external_reference"] == "UNKNOWN-1" for m in rep.data["missing"])
