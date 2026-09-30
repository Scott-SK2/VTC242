from __future__ import annotations

import logging
from datetime import datetime

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.common.exceptions import Unprocessable
from apps.common.geo import point

from . import geoindex
from .models import (
    REQUIRED_DOCUMENTS,
    DocumentStatus,
    DocumentType,
    Driver,
    DriverDocument,
    DriverStatus,
    Vehicle,
)

log = logging.getLogger("vtc242.drivers")


def documents_summary(driver: Driver) -> dict[str, str]:
    latest: dict[str, str] = {}
    for doc in driver.documents.order_by("type", "-created_at"):
        latest.setdefault(doc.type, doc.status)
    required = list(REQUIRED_DOCUMENTS)
    if driver.active_vehicle and driver.active_vehicle.category == "taxi":
        required.append(DocumentType.TAXI_CARD)
    return {t: latest.get(t, "missing") for t in required}


def blocking_reason(driver: Driver) -> str | None:
    """Pourquoi le chauffeur ne peut pas passer en ligne (F-32, section 8)."""
    if driver.status != DriverStatus.APPROVED:
        return {
            DriverStatus.PENDING: "Compte en attente de validation.",
            DriverStatus.SUSPENDED: "Compte suspendu.",
            DriverStatus.REJECTED: "Compte refusé.",
        }[driver.status]
    if driver.active_vehicle_id is None:
        return "Aucun véhicule actif."
    if driver.active_vehicle and not driver.active_vehicle.is_verified:
        return "Véhicule actif non vérifié."
    summary = documents_summary(driver)
    missing = [t for t, s in summary.items() if s != DocumentStatus.APPROVED]
    if missing:
        return "Pièces manquantes ou non validées."
    wallet = getattr(driver.user, "wallet", None)
    zone = driver.zone
    if wallet is not None and zone is not None and wallet.balance < zone.cash_debt_limit:
        return "Dette espèces au-delà du plafond : rechargez votre wallet."
    return None


@transaction.atomic
def set_online(driver: Driver, is_online: bool) -> Driver:
    driver = (
        Driver.objects.select_for_update(of=("self",))
        .select_related("user", "active_vehicle", "zone")
        .get(pk=driver.pk)
    )
    if is_online:
        reason = blocking_reason(driver)
        if reason:
            raise Unprocessable(reason, code="cannot_go_online")
        if not driver.is_online:
            driver.online_since = timezone.now()
        driver.is_online = True
        driver.is_available = not _has_active_ride(driver)
    else:
        driver.is_online = False
        driver.is_available = False
        driver.online_since = None
    driver.save(update_fields=["is_online", "is_available", "online_since", "updated_at"])
    if driver.is_online and driver.current_location:
        geoindex.update_position(driver, driver.current_location.y, driver.current_location.x)
    else:
        geoindex.remove(driver)
    return driver


def _has_active_ride(driver: Driver) -> bool:
    from apps.rides.models import ACTIVE_STATUSES, Ride

    return Ride.objects.filter(driver=driver, status__in=ACTIVE_STATUSES).exists()


def set_availability(driver: Driver, available: bool) -> None:
    Driver.objects.filter(pk=driver.pk).update(is_available=available and driver.is_online)
    driver.is_available = available and driver.is_online
    if driver.current_location:
        geoindex.update_position(driver, driver.current_location.y, driver.current_location.x)
    else:
        geoindex.remove(driver)


def record_positions(driver: Driver, positions: list[dict]) -> int:
    """Traite un lot de positions (WebSocket ou fallback REST F-41). Renvoie le nombre acceptées."""
    from apps.rides import services as ride_services

    accepted = 0
    latest: dict | None = None
    for pos in positions:
        acc = pos.get("accuracy_m")
        if acc is not None and float(acc) > settings.POSITION_MAX_ACCURACY_M:
            continue
        recorded_at = pos.get("recorded_at")
        if isinstance(recorded_at, str):
            recorded_at = parse_datetime(recorded_at)
        if not isinstance(recorded_at, datetime):
            recorded_at = timezone.now()
        pos = {**pos, "recorded_at": recorded_at}
        accepted += 1
        if latest is None or recorded_at >= latest["recorded_at"]:
            latest = pos
        ride_services.record_ride_position(driver, pos)
    if latest is not None:
        lat, lng = float(latest["lat"]), float(latest["lng"])
        was_lost = driver.position_lost_notified
        Driver.objects.filter(pk=driver.pk).update(
            current_location=point(lat, lng),
            heading=latest.get("heading"),
            last_location_at=timezone.now(),
            position_lost_notified=False,
        )
        driver.current_location = point(lat, lng)
        driver.heading = latest.get("heading")
        driver.last_location_at = timezone.now()
        driver.position_lost_notified = False
        if driver.zone_id is None:
            from apps.geo.models import Zone

            zone = Zone.resolve(driver.current_location)
            if zone:
                Driver.objects.filter(pk=driver.pk).update(zone=zone)
        geoindex.update_position(driver, lat, lng)
        if was_lost:
            ride_services.notify_position_restored(driver)
    return accepted


@transaction.atomic
def add_vehicle(driver: Driver, data: dict) -> Vehicle:
    vehicle = Vehicle.objects.create(driver=driver, **data)
    if driver.active_vehicle_id is None:
        driver.active_vehicle = vehicle
        driver.save(update_fields=["active_vehicle"])
    return vehicle


@transaction.atomic
def activate_vehicle(driver: Driver, vehicle: Vehicle) -> Vehicle:
    if driver.is_online:
        raise Unprocessable("Passez hors ligne pour changer de véhicule.", code="driver_online")
    driver.active_vehicle = vehicle
    driver.save(update_fields=["active_vehicle"])
    return vehicle


def add_document(driver: Driver, type_: str, file_url: str, expires_at=None) -> DriverDocument:
    doc = DriverDocument.objects.create(
        driver=driver, type=type_, file_url=file_url, expires_at=expires_at
    )
    if type_ == DocumentType.PROFILE_PHOTO:
        driver.user.photo_url = file_url
        driver.user.save(update_fields=["photo_url"])
    return doc


def register_decline(driver: Driver) -> None:
    """3 refus consécutifs = pause 2 min (F-33)."""
    driver.consecutive_declines += 1
    update = ["consecutive_declines"]
    if driver.consecutive_declines >= settings.DISPATCH_DECLINES_BEFORE_PAUSE:
        driver.paused_until = timezone.now() + timezone.timedelta(
            seconds=settings.DISPATCH_PAUSE_SECONDS
        )
        driver.consecutive_declines = 0
        update.append("paused_until")
    driver.save(update_fields=update)


def reset_declines(driver: Driver) -> None:
    if driver.consecutive_declines:
        Driver.objects.filter(pk=driver.pk).update(consecutive_declines=0)
