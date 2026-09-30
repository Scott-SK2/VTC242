from decimal import Decimal

import pytest
from django.utils import timezone

from apps.common import sms
from apps.payments import services as payments
from apps.payments.models import WalletTransaction
from apps.realtime import events
from apps.rides.models import Ride, RideOffer
from apps.safety.models import Alert

from .conftest import DROPOFF, PICKUP, client_for, make_driver, make_user, request_ride

pytestmark = pytest.mark.django_db


def test_estimate_returns_price_range_per_category(api, rules, driver):
    r = api.post("/api/v1/rides/estimate", {"pickup": PICKUP, "dropoff": DROPOFF}, format="json")
    assert r.status_code == 200
    cats = {e["category"]: e for e in r.data["estimates"]}
    assert set(cats) == {"taxi", "standard", "vip"}
    taxi = cats["taxi"]
    assert Decimal(taxi["price_min"]) <= Decimal(taxi["price_max"])
    assert Decimal(taxi["price_max"]) % 100 == 0
    assert taxi["available_drivers"] == 1 and taxi["eta_pickup_s"] is not None
    assert taxi["cash_enabled"] is True and cats["vip"]["cash_enabled"] is False


def test_estimate_out_of_zone(api, rules):
    r = api.post(
        "/api/v1/rides/estimate",
        {"pickup": {"lat": 0, "lng": 0, "address": "x"}, "dropoff": DROPOFF},
        format="json",
    )
    assert r.status_code == 422 and r.data["code"] == "out_of_zone"


def test_nominal_ride_flow(api, driver_api, passenger, driver, rules):
    """A-02 : parcours nominal complet, prix = formule 8.4,
    wallets cohérents avec le grand livre."""
    r = request_ride(api)
    assert r.status_code == 201, r.content
    ride_id = r.data["id"]
    assert r.data["status"] == "dispatching"
    assert len(r.data["otp_code"]) == 4
    reserved = Decimal(r.data["reserved_amount"])
    assert reserved == Decimal(r.data["estimated_price_max"])
    wallet = payments.get_wallet(passenger)
    assert wallet.reserved_balance == reserved

    # offre envoyée au chauffeur (dispatch eager)
    assert RideOffer.objects.filter(ride_id=ride_id, driver=driver).exists()
    assert any(
        e["event"] == "ride.offer" and e["group"] == f"user.{driver.user_id}" for e in events.SENT
    )
    cur = driver_api.get("/api/v1/drivers/me/offers/current")
    assert cur.status_code == 200 and cur.data["ride_id"] == ride_id

    r = driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    assert r.status_code == 200, r.content
    assert r.data["status"] == "accepted"
    assert r.data["otp_code"] is None  # jamais côté chauffeur
    assert (
        r.data["passenger"]["first_name"] == "Scott" and r.data["passenger"]["last_initial"] == "K"
    )
    assert "phone" not in str(r.content)
    # SMS chauffeur trouvé + code
    p = api.get(f"/api/v1/rides/{ride_id}")
    code = p.data["otp_code"]
    assert p.data["driver"]["vehicle"]["license_plate"] == driver.active_vehicle.license_plate
    assert any(code in m["body"] for m in sms.OUTBOX)
    driver.refresh_from_db()
    assert driver.is_available is False

    # arrivée trop loin → 422, puis arrivée
    far = driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive", {"lat": -4.30, "lng": 15.30}, format="json"
    )
    assert far.status_code == 422 and far.data["code"] == "too_far"
    ok = driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive",
        {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    assert ok.status_code == 200 and ok.data["status"] == "arrived"

    # code faux puis bon
    bad = driver_api.post(f"/api/v1/rides/{ride_id}/start", {"otp_code": "0000"}, format="json")
    assert bad.status_code == 400 and bad.data["details"]["attempts_left"] == 2
    good = driver_api.post(
        f"/api/v1/rides/{ride_id}/start",
        {"otp_code": code, "lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    assert good.status_code == 200 and good.data["status"] == "in_progress"
    assert good.data["planned_route"]

    # positions pendant la course
    r = driver_api.post(
        "/api/v1/drivers/me/location",
        {
            "positions": [
                {
                    "lat": -4.26,
                    "lng": 15.27,
                    "accuracy_m": 10,
                    "recorded_at": timezone.now().isoformat(),
                }
            ]
        },
        format="json",
    )
    assert r.status_code == 202 and r.data["accepted"] == 1
    assert any(e["event"] == "ride.driver_position" for e in events.SENT)

    # clôture trop loin, puis validation passager, puis clôture
    far = driver_api.post(
        f"/api/v1/rides/{ride_id}/complete", {"lat": -4.30, "lng": 15.30}, format="json"
    )
    assert far.status_code == 422
    assert api.post(f"/api/v1/rides/{ride_id}/confirm-arrival").status_code == 200
    done = driver_api.post(
        f"/api/v1/rides/{ride_id}/complete", {"lat": -4.30, "lng": 15.30}, format="json"
    )
    assert done.status_code == 200, done.content
    assert done.data["status"] == "completed"
    ride = Ride.objects.get(pk=ride_id)
    rule = rules["taxi"]
    from apps.geo.pricing import compute_price

    expected = compute_price(
        rule, ride.planned_distance_m, ride.ride_seconds, ride.waiting_seconds
    ).price
    assert ride.final_price == expected
    assert ride.final_price >= rule.minimum_fare and ride.final_price % 100 == 0
    assert ride.commission_amount == (ride.final_price * rule.commission_rate).quantize(
        Decimal("1")
    )
    assert ride.driver_earning == ride.final_price - ride.commission_amount

    # wallets cohérents avec wallet_transactions
    pw = payments.get_wallet(passenger)
    dw = payments.get_wallet(driver.user)
    assert pw.reserved_balance == 0
    assert pw.balance == Decimal("10000") - ride.final_price
    assert dw.balance == ride.driver_earning
    for w in (pw, dw):
        total = sum(
            t.amount for t in WalletTransaction.objects.filter(wallet=w, status="completed")
        )
        assert total == w.balance
    driver.refresh_from_db()
    assert driver.is_available is True

    # notation des deux côtés, une seule fois
    assert (
        api.post(
            f"/api/v1/rides/{ride_id}/rate", {"score": 5, "comment": "Parfait"}, format="json"
        ).status_code
        == 201
    )
    assert api.post(f"/api/v1/rides/{ride_id}/rate", {"score": 4}, format="json").status_code == 409
    assert (
        driver_api.post(f"/api/v1/rides/{ride_id}/rate", {"score": 4}, format="json").status_code
        == 201
    )
    driver.refresh_from_db()
    assert driver.rating_avg == Decimal("5.00") and driver.rating_count == 1
    # reçu PDF
    pdf = api.get(f"/api/v1/rides/{ride_id}/receipt")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    # contestation possible dans les 24 h
    d = api.post(f"/api/v1/rides/{ride_id}/dispute", {"reason": "Trajet plus long"}, format="json")
    assert d.status_code == 201 and d.data["status"] == "open"


def test_insufficient_funds_returns_402_without_reservation(api, passenger, rules, driver):
    """A-03."""
    payments.adjust(passenger, Decimal("-9900"), "vider")
    r = request_ride(api, category="vip")
    assert r.status_code == 402 and r.data["code"] == "insufficient_funds"
    assert Ride.objects.count() == 0
    assert payments.get_wallet(passenger).reserved_balance == 0


def test_one_active_ride_per_passenger(api, rules, driver):
    assert request_ride(api).status_code == 201
    r = request_ride(api)
    assert r.status_code == 409 and r.data["code"] == "ride_already_active"


def test_idempotency_key_returns_same_ride(api, rules, driver):
    import uuid

    key = str(uuid.uuid4())
    est = api.post("/api/v1/rides/estimate", {"pickup": PICKUP, "dropoff": DROPOFF}, format="json")
    rule_id = est.data["estimates"][0]["pricing_rule_id"]
    body = {
        "category": "taxi",
        "pricing_rule_id": rule_id,
        "payment_method": "wallet",
        "pickup": PICKUP,
        "dropoff": DROPOFF,
    }
    r1 = api.post("/api/v1/rides", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    r2 = api.post("/api/v1/rides", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert r1.status_code == 201 and r2.status_code == 201 and r1.data["id"] == r2.data["id"]
    assert Ride.objects.count() == 1


def test_no_driver_after_all_offers_timeout(api, passenger, rules, zone):
    """A-04 : aucune réponse → no_driver, fonds libérés, passager informé."""
    from apps.rides import dispatch

    drivers = [make_driver(f"+24206100001{i}", zone, lat=-4.266 + i * 0.001) for i in range(6)]
    r = request_ride(api)
    ride = Ride.objects.get(pk=r.data["id"])
    assert payments.get_wallet(passenger).reserved_balance > 0
    for _ in range(6):
        offer = RideOffer.objects.filter(ride=ride, response__isnull=True).first()
        if offer is None:
            break
        RideOffer.objects.filter(pk=offer.pk).update(
            expires_at=timezone.now() - timezone.timedelta(seconds=1)
        )
        dispatch.expire_offer_if_due(offer.pk)
    ride.refresh_from_db()
    assert ride.status == "no_driver"
    assert ride.offers_count == 5
    assert payments.get_wallet(passenger).reserved_balance == 0
    assert any(
        e["event"] == "ride.status_updated" and e["data"]["status"] == "no_driver"
        for e in events.SENT
    )
    assert len(drivers) == 6


def test_decline_passes_to_next_driver_and_pauses_after_three(api, rules, zone):
    from apps.drivers.models import Driver

    d1 = make_driver("+242061000021", zone, lat=-4.2655, lng=15.2805)
    d2 = make_driver("+242061000022", zone, lat=-4.2680, lng=15.2830)
    r = request_ride(api)
    ride_id = r.data["id"]
    first = RideOffer.objects.get(ride_id=ride_id)
    assert first.driver_id == d1.id
    c1 = client_for(d1.user)
    assert c1.post(f"/api/v1/rides/{ride_id}/decline").status_code == 204
    second = RideOffer.objects.filter(ride_id=ride_id, response__isnull=True).get()
    assert second.driver_id == d2.id
    # une offre expirée ne peut plus être acceptée
    assert c1.post(f"/api/v1/rides/{ride_id}/accept").status_code == 409
    # 3 refus consécutifs → pause 2 min
    Driver.objects.filter(pk=d1.pk).update(consecutive_declines=2)
    from apps.drivers import services

    d1.refresh_from_db()
    services.register_decline(d1)
    d1.refresh_from_db()
    assert d1.paused_until and d1.paused_until > timezone.now()


def test_three_wrong_start_codes_lock_ride_and_alert(api, driver_api, driver, rules):
    """A-05 : 423 et alerte back-office."""
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive",
        {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    for _ in range(2):
        assert (
            driver_api.post(
                f"/api/v1/rides/{ride_id}/start", {"otp_code": "1111"}, format="json"
            ).status_code
            == 400
        )
    r = driver_api.post(f"/api/v1/rides/{ride_id}/start", {"otp_code": "1111"}, format="json")
    assert r.status_code == 423 and r.data["code"] == "ride_locked"
    assert Alert.objects.filter(type="otp_locked", ride_id=ride_id).exists()
    assert any(e["event"] == "admin.alert" and e["group"] == "backoffice" for e in events.SENT)
    assert api.get(f"/api/v1/rides/{ride_id}").data["otp_locked"] is True


def test_cancel_after_accept_charges_fee_and_credits_driver(
    api, driver_api, passenger, driver, rules
):
    """A-08."""
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    preview = api.get(f"/api/v1/rides/{ride_id}").data["cancellation_fee_preview"]
    assert Decimal(preview) == Decimal("500.00")
    r = api.post(f"/api/v1/rides/{ride_id}/cancel", {"reason": "Changement de plan"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "cancelled_by_passenger"
    assert Decimal(r.data["cancellation_fee"]) == Decimal("500.00")
    pw = payments.get_wallet(passenger)
    assert pw.balance == Decimal("9500") and pw.reserved_balance == 0
    assert payments.get_wallet(driver.user).balance == Decimal("250")
    assert WalletTransaction.objects.filter(ride_id=ride_id, type="cancellation_fee").exists()
    from apps.rides.models import RideEvent

    assert RideEvent.objects.filter(
        ride_id=ride_id, event_type="status.cancelled_by_passenger"
    ).exists()
    driver.refresh_from_db()
    assert driver.is_available is True


def test_cancel_before_accept_is_free(api, passenger, rules, driver):
    ride_id = request_ride(api).data["id"]
    r = api.post(f"/api/v1/rides/{ride_id}/cancel", {"reason": ""}, format="json")
    assert r.status_code == 200 and Decimal(r.data["cancellation_fee"]) == 0
    assert payments.get_wallet(passenger).balance == Decimal("10000")
    assert payments.get_wallet(passenger).reserved_balance == 0


def test_cash_ride_debits_commission_only(api, driver_api, passenger, driver, rules):
    ride_id = request_ride(api, payment_method="cash").data["id"]
    assert payments.get_wallet(passenger).reserved_balance == 0
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive",
        {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    code = api.get(f"/api/v1/rides/{ride_id}").data["otp_code"]
    driver_api.post(f"/api/v1/rides/{ride_id}/start", {"otp_code": code}, format="json")
    r = driver_api.post(
        f"/api/v1/rides/{ride_id}/complete",
        {"lat": DROPOFF["lat"], "lng": DROPOFF["lng"]},
        format="json",
    )
    assert r.status_code == 200
    ride = Ride.objects.get(pk=ride_id)
    assert payments.get_wallet(passenger).balance == Decimal("10000")
    assert payments.get_wallet(driver.user).balance == -ride.commission_amount


def test_other_passenger_ride_is_404_and_no_phone_numbers(api, rules, driver):
    """A-18."""
    ride_id = request_ride(api).data["id"]
    other = make_user("+242069000009", "passenger")
    assert client_for(other).get(f"/api/v1/rides/{ride_id}").status_code == 404
    body = api.get(f"/api/v1/rides/{ride_id}").content.decode()
    assert "+242" not in body and "phone" not in body
    for frame in events.SENT:
        assert "+242" not in str(frame["data"])


def test_chat_presets_and_share_link(api, driver_api, driver, rules):
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    m = driver_api.post(f"/api/v1/rides/{ride_id}/messages", {"preset": "arriving"}, format="json")
    assert m.status_code == 201 and m.data["sender_role"] == "driver"
    msgs = api.get(f"/api/v1/rides/{ride_id}/messages")
    assert len(msgs.data["results"]) == 1
    share = api.post(f"/api/v1/rides/{ride_id}/share")
    assert share.status_code == 201
    from rest_framework.test import APIClient

    pub = APIClient().get(f"/api/v1/share/{share.data['token']}")
    assert pub.status_code == 200 and pub.data["status"] == "accepted"
    assert "+242" not in pub.content.decode()
    em = api.post(
        f"/api/v1/rides/{ride_id}/emergency",
        {"number_called": "117", "lat": -4.26, "lng": 15.28},
        format="json",
    )
    assert em.status_code == 201
    assert Alert.objects.filter(type="emergency", ride_id=ride_id).exists()
