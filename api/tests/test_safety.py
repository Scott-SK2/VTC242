import pytest
from django.utils import timezone

from apps.realtime import events
from apps.safety import services as safety
from apps.safety.models import Alert, RouteDeviation

from .conftest import PICKUP, request_ride

pytestmark = pytest.mark.django_db


def _start_ride(api, driver_api):
    ride_id = request_ride(api).data["id"]
    driver_api.post(f"/api/v1/rides/{ride_id}/accept")
    driver_api.post(
        f"/api/v1/rides/{ride_id}/arrive",
        {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    code = api.get(f"/api/v1/rides/{ride_id}").data["otp_code"]
    r = driver_api.post(
        f"/api/v1/rides/{ride_id}/start",
        {"otp_code": code, "lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        format="json",
    )
    assert r.status_code == 200
    from apps.rides.models import Ride

    return Ride.objects.select_related("zone", "passenger").get(pk=ride_id)


def test_deviation_alert_after_three_positions_then_cleared(api, driver_api, driver, rules):
    """A-06 : 400 m hors itinéraire → alerte après 3 positions ; levée au retour."""
    ride = _start_ride(api, driver_api)
    # itinéraire vol d'oiseau pickup→dropoff ; un point à ~1 km au sud-est est hors couloir
    off_lat, off_lng = -4.2750, 15.2900
    safety.check_position(ride, off_lat, off_lng)
    safety.check_position(ride, off_lat, off_lng)
    assert not RouteDeviation.objects.filter(ride=ride).exists()
    safety.check_position(ride, off_lat, off_lng)
    dev = RouteDeviation.objects.get(ride=ride)
    assert dev.distance_off_m > 300 and dev.alert_sent_at is not None
    assert any(
        e["event"] == "ride.deviation_alert" and e["group"] == f"user.{ride.passenger_id}"
        for e in events.SENT
    )
    alert = Alert.objects.get(type="deviation", ride=ride)
    assert alert.payload["emergency_numbers"]["police"] == "117"
    assert api.get(f"/api/v1/rides/{ride.id}").data["deviation"]["active"] is True
    # retour dans le couloir
    safety.check_position(ride, PICKUP["lat"], PICKUP["lng"])
    dev.refresh_from_db()
    assert dev.cleared_at is not None
    assert any(e["event"] == "ride.deviation_cleared" for e in events.SENT)


def test_reported_detour_suspends_alerts(api, driver_api, driver, rules):
    ride = _start_ride(api, driver_api)
    r = driver_api.post(
        f"/api/v1/rides/{ride.id}/detour", {"reason": "Route barrée"}, format="json"
    )
    assert r.status_code == 200 and r.data["detour_until"]
    ride.refresh_from_db()
    assert ride.detour_until > timezone.now()
    for _ in range(4):
        safety.check_position(ride, -4.2750, 15.2900)
    assert not RouteDeviation.objects.filter(ride=ride).exists()
    assert Alert.objects.filter(type="detour", ride=ride).exists()


def test_position_lost_watchdog_notifies_passenger(api, driver_api, driver, rules):
    """A-07 : bandeau « position perdue » après 30 s."""
    from apps.drivers.models import Driver
    from apps.drivers.tasks import position_watchdog

    ride = _start_ride(api, driver_api)
    Driver.objects.filter(pk=driver.pk).update(
        last_location_at=timezone.now() - timezone.timedelta(seconds=45)
    )
    assert position_watchdog() == 1
    assert any(
        e["event"] == "ride.position_lost" and e["group"] == f"user.{ride.passenger_id}"
        for e in events.SENT
    )
    assert Alert.objects.filter(type="position_lost", ride=ride).exists()
    # positions rejouées à la reconnexion (batch) → restaurée
    r = driver_api.post(
        "/api/v1/drivers/me/location",
        {
            "positions": [
                {
                    "lat": -4.262,
                    "lng": 15.275,
                    "accuracy_m": 8,
                    "recorded_at": timezone.now().isoformat(),
                }
                for _ in range(3)
            ]
        },
        format="json",
    )
    assert r.status_code == 202 and r.data["accepted"] == 3
    assert any(e["event"] == "ride.position_restored" for e in events.SENT)


def test_inaccurate_positions_are_ignored(driver_api, driver):
    r = driver_api.post(
        "/api/v1/drivers/me/location",
        {"positions": [{"lat": -4.26, "lng": 15.28, "accuracy_m": 250}]},
        format="json",
    )
    assert r.status_code == 202 and r.data["accepted"] == 0
