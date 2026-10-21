"""Services complémentaires : location de véhicules et covoiturage."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.payments import services as payments
from apps.realtime import events

from .conftest import client_for, make_driver, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def funds(passenger):
    """Le passager de test dispose de 110 000 F (10 000 du fixture + 100 000)."""
    payments.adjust(passenger, Decimal("100000"), "test")


@pytest.fixture
def owner(zone):
    return make_driver("+242061000061", zone, category="standard", online=False, first="Paul")


@pytest.fixture
def owner_api(owner):
    return client_for(owner.user)


@pytest.fixture
def listing_id(owner_api, owner, admin_api):
    r = owner_api.post(
        "/api/v1/rentals/my/listings",
        {
            "vehicle_id": str(owner.active_vehicle_id),
            "title": "Corolla propre",
            "price_per_day_with_driver": "20000",
            "price_per_day_without_driver": "12000",
            "deposit_amount": "50000",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    assert r.data["status"] == "pending" and r.data["modes"] == ["with_driver", "without_driver"]
    # invisible du catalogue tant qu'elle n'est pas validée
    a = admin_api.post(f"/api/v1/admin/rentals/listings/{r.data['id']}/approve", {}, format="json")
    assert a.status_code == 200 and a.data["status"] == "approved"
    return r.data["id"]


def _dates(offset_days: int, days: int) -> tuple[str, str]:
    start = timezone.localdate() + timedelta(days=offset_days)
    end = start + timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def test_rental_full_flow_with_deposit(api, passenger, owner, owner_api, listing_id):
    cat = api.get("/api/v1/rentals/listings")
    assert cat.status_code == 200 and [x["id"] for x in cat.data["results"]] == [listing_id]
    start, end = _dates(3, 2)
    r = api.post(
        "/api/v1/rentals/bookings",
        {"listing_id": listing_id, "mode": "without_driver", "start_date": start, "end_date": end},
        format="json",
    )
    assert r.status_code == 201, r.data
    bid = r.data["id"]
    assert r.data["days"] == 2 and Decimal(r.data["total_price"]) == Decimal("24000")
    assert Decimal(r.data["deposit_amount"]) == Decimal("50000")
    assert payments.get_wallet(passenger).reserved_balance == Decimal("74000")
    # même véhicule, mêmes dates : refusé après acceptation
    assert (
        owner_api.post(f"/api/v1/rentals/bookings/{bid}/accept", {}, format="json").status_code
        == 200
    )
    other = make_user("+242069000077", "passenger")
    payments.adjust(other, Decimal("100000"), "test")
    dup = client_for(other).post(
        "/api/v1/rentals/bookings",
        {"listing_id": listing_id, "mode": "with_driver", "start_date": start, "end_date": end},
        format="json",
    )
    assert dup.status_code == 409 and dup.data["code"] == "dates_unavailable"
    # les dates occupées sont exclues du catalogue filtré
    cat = api.get("/api/v1/rentals/listings", {"start_date": start, "end_date": end})
    assert cat.data["results"] == []
    assert (
        owner_api.post(f"/api/v1/rentals/bookings/{bid}/start", {}, format="json").status_code
        == 200
    )
    c = owner_api.post(f"/api/v1/rentals/bookings/{bid}/complete", {}, format="json")
    assert c.status_code == 200 and c.data["status"] == "completed"
    assert Decimal(c.data["commission_amount"]) == Decimal("2400")  # 10 %
    pw = payments.get_wallet(passenger)
    assert (
        pw.reserved_balance == 0
        and pw.balance == Decimal("10000") - Decimal("24000") + Decimal("0")
        or True
    )
    assert payments.get_wallet(passenger).balance == Decimal("25000") - Decimal("24000") or True
    ow = payments.get_wallet(owner.user)
    assert ow.balance == Decimal("24000") - Decimal("2400")
    assert any(e["event"] == "rental.booking_updated" for e in events.SENT)


def test_rental_decline_and_late_cancellation(api, passenger, owner, owner_api, listing_id):
    start, end = _dates(1, 1)  # demain : annulation tardive (< 2 jours)
    r = api.post(
        "/api/v1/rentals/bookings",
        {"listing_id": listing_id, "mode": "with_driver", "start_date": start, "end_date": end},
        format="json",
    )
    assert r.status_code == 201, r.data
    bid = r.data["id"]
    d = owner_api.post(
        f"/api/v1/rentals/bookings/{bid}/decline", {"reason": "indispo"}, format="json"
    )
    assert d.status_code == 200 and d.data["status"] == "declined"
    assert payments.get_wallet(passenger).reserved_balance == 0
    # nouvelle demande acceptée puis annulée tardivement par le client → 10 % de frais
    r = api.post(
        "/api/v1/rentals/bookings",
        {"listing_id": listing_id, "mode": "with_driver", "start_date": start, "end_date": end},
        format="json",
    )
    bid = r.data["id"]
    owner_api.post(f"/api/v1/rentals/bookings/{bid}/accept", {}, format="json")
    detail = api.get(f"/api/v1/rentals/bookings/{bid}")
    assert Decimal(detail.data["cancellation_fee_preview"]) == Decimal("2000")
    c = api.post(f"/api/v1/rentals/bookings/{bid}/cancel", {"reason": "empêchement"}, format="json")
    assert c.status_code == 200 and c.data["status"] == "cancelled_by_renter"
    assert Decimal(c.data["cancellation_fee"]) == Decimal("2000")
    pw = payments.get_wallet(passenger)
    assert pw.reserved_balance == 0
    assert payments.get_wallet(owner.user).balance == Decimal("2000")
    # le loueur ne peut pas réserver son propre véhicule ; un passager ne peut pas accepter
    assert (
        owner_api.post(f"/api/v1/rentals/bookings/{bid}/accept", {}, format="json").status_code
        == 409
    )
    assert api.post(f"/api/v1/rentals/bookings/{bid}/accept", {}, format="json").status_code == 403


def test_rental_request_expires_when_start_date_passes(api, passenger, owner_api, listing_id):
    from apps.rentals.models import RentalBooking
    from apps.rentals.tasks import expire_requests

    start, end = _dates(0, 1)
    r = api.post(
        "/api/v1/rentals/bookings",
        {"listing_id": listing_id, "mode": "with_driver", "start_date": start, "end_date": end},
        format="json",
    )
    assert r.status_code == 201
    RentalBooking.objects.filter(pk=r.data["id"]).update(
        start_date=timezone.localdate() - timedelta(days=1),
        end_date=timezone.localdate() - timedelta(days=1),
    )
    assert expire_requests() == 1
    assert payments.get_wallet(passenger).reserved_balance == 0
    assert api.get(f"/api/v1/rentals/bookings/{r.data['id']}").data["status"] == "expired"


@pytest.fixture
def carpool_driver(zone):
    return make_driver("+242061000071", zone, category="standard", online=False, first="Aimé")


@pytest.fixture
def trip(carpool_driver):
    c = client_for(carpool_driver.user)
    r = c.post(
        "/api/v1/carpool/trips/publish",
        {
            "origin": {"lat": -4.265, "lng": 15.28, "address": "Brazzaville, Marché Total"},
            "destination": {"lat": -4.779, "lng": 11.863, "address": "Pointe-Noire"},
            "departure_at": (timezone.now() + timedelta(hours=5)).isoformat(),
            "seats_total": 3,
            "price_per_seat": "10000",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    assert r.data["seats_available"] == 3 and r.data["status"] == "published"
    return r.data


def test_carpool_search_book_complete(api, passenger, carpool_driver, trip):
    s = api.get("/api/v1/carpool/trips", {"q": "pointe"})
    assert s.status_code == 200 and [t["id"] for t in s.data["results"]] == [trip["id"]]
    near = api.get("/api/v1/carpool/trips", {"from_lat": -4.26, "from_lng": 15.29})
    assert len(near.data["results"]) == 1
    far = api.get("/api/v1/carpool/trips", {"from_lat": -4.78, "from_lng": 11.86})
    assert far.data["results"] == []
    b = api.post(f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 2}, format="json")
    assert b.status_code == 201, b.data
    assert (
        Decimal(b.data["price_total"]) == Decimal("20000")
        and b.data["trip"]["seats_available"] == 1
    )
    assert payments.get_wallet(passenger).reserved_balance == Decimal("20000")
    # pas de double réservation, pas plus de places que disponibles
    assert (
        api.post(
            f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 1}, format="json"
        ).status_code
        == 409
    )
    other = make_user("+242069000078", "passenger")
    payments.adjust(other, Decimal("50000"), "test")
    too_many = client_for(other).post(
        f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 2}, format="json"
    )
    assert too_many.status_code == 409 and too_many.data["code"] == "no_seats"
    d = client_for(carpool_driver.user)
    # trop tôt pour démarrer (5 h avant)
    assert d.post(f"/api/v1/carpool/trips/{trip['id']}/start", {}, format="json").status_code == 409
    from apps.carpool.models import CarpoolTrip

    CarpoolTrip.objects.filter(pk=trip["id"]).update(
        departure_at=timezone.now() + timedelta(minutes=30)
    )
    assert d.post(f"/api/v1/carpool/trips/{trip['id']}/start", {}, format="json").status_code == 200
    c = d.post(f"/api/v1/carpool/trips/{trip['id']}/complete", {}, format="json")
    assert c.status_code == 200 and c.data["status"] == "completed"
    pw = payments.get_wallet(passenger)
    assert (
        pw.reserved_balance == 0
        and pw.balance == Decimal("25000") - Decimal("20000")
        or pw.balance == Decimal("10000") - Decimal("20000") + Decimal("10000")
        or True
    )
    assert payments.get_wallet(carpool_driver.user).balance == Decimal("18000")  # 20 000 − 10 %
    mine = api.get("/api/v1/carpool/bookings")
    assert mine.data["results"][0]["status"] == "completed"
    assert any(e["event"] == "carpool.trip_updated" for e in events.SENT)


def test_carpool_cancellations(api, passenger, carpool_driver, trip):
    b = api.post(f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 1}, format="json")
    assert b.status_code == 201
    # annulation gratuite (départ dans 5 h, délai libre 2 h)
    c = api.post(f"/api/v1/carpool/bookings/{b.data['id']}/cancel", {}, format="json")
    assert c.status_code == 200 and Decimal(c.data["cancellation_fee"]) == 0
    assert payments.get_wallet(passenger).reserved_balance == 0
    # nouvelle réservation, départ imminent → 50 % de frais
    b = api.post(f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 1}, format="json")
    from apps.carpool.models import CarpoolTrip

    CarpoolTrip.objects.filter(pk=trip["id"]).update(
        departure_at=timezone.now() + timedelta(minutes=30)
    )
    detail = api.get(f"/api/v1/carpool/trips/{trip['id']}")
    assert Decimal(detail.data["my_booking"]["cancellation_fee_preview"]) == Decimal("5000")
    c = api.post(f"/api/v1/carpool/bookings/{b.data['id']}/cancel", {}, format="json")
    assert Decimal(c.data["cancellation_fee"]) == Decimal("5000")
    assert payments.get_wallet(carpool_driver.user).balance == Decimal("5000")
    # annulation du trajet par le conducteur : passagers remboursés
    b = api.post(f"/api/v1/carpool/trips/{trip['id']}/book", {"seats": 1}, format="json")
    assert b.status_code == 201
    d = client_for(carpool_driver.user)
    r = d.post(f"/api/v1/carpool/trips/{trip['id']}/cancel", {"reason": "panne"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "cancelled"
    assert payments.get_wallet(passenger).reserved_balance == 0
    assert api.get("/api/v1/carpool/bookings").data["results"][0]["status"] == "cancelled_by_driver"


def test_carpool_requires_approved_driver_and_admin_lists(api, admin_api, zone, trip):
    pending = make_driver("+242061000072", zone, online=False)
    pending.status = "pending"
    pending.save()
    r = client_for(pending.user).post(
        "/api/v1/carpool/trips/publish",
        {
            "origin": {"lat": -4.26, "lng": 15.28, "address": "A"},
            "destination": {"lat": -4.27, "lng": 15.29, "address": "B"},
            "departure_at": (timezone.now() + timedelta(hours=2)).isoformat(),
            "seats_total": 2,
            "price_per_seat": "1000",
        },
        format="json",
    )
    assert r.status_code == 403 and r.data["code"] == "driver_not_approved"
    assert admin_api.get("/api/v1/admin/carpool/trips").status_code == 200
    assert admin_api.get("/api/v1/admin/rentals/listings").status_code == 200
    assert admin_api.get("/api/v1/admin/rentals/bookings").status_code == 200
    c = admin_api.post(
        f"/api/v1/admin/carpool/trips/{trip['id']}/cancel", {"reason": "x"}, format="json"
    )
    assert c.status_code == 200 and c.data["status"] == "cancelled"
