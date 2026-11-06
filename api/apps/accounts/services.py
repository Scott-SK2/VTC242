from __future__ import annotations

import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from apps.common.exceptions import ApiError, Locked
from apps.common.sms import send_sms

from .authentication import issue_tokens
from .models import OtpCode, User, UserRole

log = logging.getLogger("vtc242.accounts")


def normalize_phone(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("00242"):
        digits = digits[2:]
    if digits.startswith("242") and len(digits) == 12:
        return "+" + digits
    if len(digits) == 9 and digits[0] in "0456789":
        return "+242" + digits
    raise ApiError("Numéro congolais (+242) attendu.", code="invalid_phone")


def request_otp(phone_number: str) -> dict:
    """F-01 : OTP 6 chiffres, valable 5 min ; 429 au-delà de 3 envois / 15 min."""
    phone = normalize_phone(phone_number)
    now = timezone.now()
    window_start = now - timedelta(seconds=settings.OTP_SEND_WINDOW_SECONDS)
    sends = OtpCode.objects.filter(phone_number=phone, created_at__gte=window_start).count()
    if sends >= settings.OTP_MAX_SENDS_PER_WINDOW:
        raise ApiError(
            "Trop de demandes de code. Réessayez dans 15 minutes.",
            code="rate_limited",
            status_code=429,
        )
    lock = (
        OtpCode.objects.filter(phone_number=phone, locked_until__gt=now)
        .order_by("-locked_until")
        .first()
    )
    if lock:
        raise Locked(
            "Numéro bloqué après 3 codes erronés.",
            code="otp_locked",
            details={"locked_until": lock.locked_until.isoformat()},
        )
    code = "".join(secrets.choice("0123456789") for _ in range(settings.OTP_LENGTH))
    OtpCode.objects.filter(phone_number=phone, consumed_at__isnull=True).update(consumed_at=now)
    OtpCode.objects.create(
        phone_number=phone,
        code_hash=make_password(code),
        expires_at=now + timedelta(seconds=settings.OTP_TTL_SECONDS),
    )
    send_sms(phone, f"VTC 242 : votre code de connexion est {code}. Valable 5 minutes.")
    payload = {"expires_in": settings.OTP_TTL_SECONDS}
    if settings.DEBUG_OTP_IN_RESPONSE:
        payload["debug_code"] = code
    return payload


def _check_otp(phone: str, code: str) -> None:
    """Vérifie le code dans sa propre transaction : les tentatives et le blocage sont
    persistés même si une erreur est renvoyée."""
    now = timezone.now()
    error: ApiError | None = None
    with transaction.atomic():
        otp = (
            OtpCode.objects.select_for_update()
            .filter(phone_number=phone, consumed_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if otp and otp.locked_until and otp.locked_until > now:
            raise Locked(
                "Numéro bloqué après 3 codes erronés.",
                code="otp_locked",
                details={"locked_until": otp.locked_until.isoformat()},
            )
        if otp is None or otp.is_expired:
            raise ApiError("Code expiré. Demandez un nouveau code.", code="otp_expired")
        if not check_password(code, otp.code_hash):
            otp.attempts += 1
            if otp.attempts >= settings.OTP_MAX_ATTEMPTS:
                otp.locked_until = now + timedelta(seconds=settings.OTP_LOCK_SECONDS)
                otp.consumed_at = now
                otp.save(update_fields=["attempts", "locked_until", "consumed_at"])
                error = Locked(
                    "3 codes erronés : numéro bloqué 15 minutes.",
                    code="otp_locked",
                    details={"locked_until": otp.locked_until.isoformat()},
                )
            else:
                otp.save(update_fields=["attempts"])
                error = ApiError(
                    "Code invalide.",
                    code="invalid_otp",
                    details={"attempts_left": settings.OTP_MAX_ATTEMPTS - otp.attempts},
                )
        else:
            otp.consumed_at = now
            otp.save(update_fields=["consumed_at"])
    if error is not None:
        raise error


def verify_otp(
    phone_number: str, code: str, role: str | None = None, device_id: str | None = None
) -> dict:
    phone = normalize_phone(phone_number)
    _check_otp(phone, code)
    with transaction.atomic():
        return _login_or_create(phone, role, device_id)


MODES = (UserRole.PASSENGER, UserRole.DRIVER)


def mode_switch_blocker(user: User) -> str | None:
    """Raison empêchant de quitter le mode actuel (course ou trajet en cours), sinon None."""
    from apps.rides.models import ACTIVE_STATUSES, Ride

    if user.role == UserRole.PASSENGER:
        if Ride.objects.filter(passenger=user, status__in=ACTIVE_STATUSES).exists():
            return "Terminez ou annulez votre course en cours avant de changer de mode."
    elif user.role == UserRole.DRIVER:
        driver = getattr(user, "driver", None)
        if driver and Ride.objects.filter(driver=driver, status__in=ACTIVE_STATUSES).exists():
            return "Terminez votre course en cours avant de changer de mode."
        from apps.carpool.models import CarpoolTrip, TripStatus

        if CarpoolTrip.objects.filter(driver=user, status=TripStatus.IN_PROGRESS).exists():
            return "Terminez votre trajet de covoiturage en cours avant de changer de mode."
    return None


def _apply_mode(user: User, target: str) -> None:
    """Passe le compte en mode passager ou chauffeur (même compte, même wallet). En quittant le
    mode chauffeur, le chauffeur est mis hors ligne et retiré de l'index géographique."""
    from apps.drivers import geoindex
    from apps.drivers.models import Driver

    if user.role == target:
        return
    if user.role == UserRole.DRIVER:
        driver = Driver.objects.filter(user=user).first()
        if driver:
            Driver.objects.filter(pk=driver.pk).update(is_online=False, is_available=False)
            driver.is_online = driver.is_available = False
            geoindex.remove(driver)
    if target == UserRole.DRIVER:
        Driver.objects.get_or_create(user=user)
    user.role = target
    user.save(update_fields=["role"])


@transaction.atomic
def switch_mode(user: User, target: str, device_id: str | None = None) -> dict:
    """Bascule passager ↔ chauffeur d'un même compte (le rôle porte le mode actif)."""
    if user.role not in MODES or target not in MODES:
        raise ApiError(
            "Changement de mode impossible pour ce compte.", code="forbidden", status_code=403
        )
    user = User.objects.select_for_update().get(pk=user.pk)
    if user.role != target:
        reason = mode_switch_blocker(user)
        if reason:
            raise ApiError(reason, code="mode_switch_blocked", status_code=409)
        _apply_mode(user, target)
    return _issue_for(user, device_id)


def _issue_for(user: User, device_id: str | None) -> dict:
    if user.role == UserRole.DRIVER:
        device_id = device_id or uuid.uuid4().hex
        user.active_device_id = device_id
        user.save(update_fields=["active_device_id"])
    else:
        device_id = None
    tokens = issue_tokens(user, device_id=device_id)
    return {**tokens, "user": user}


def _login_or_create(phone: str, role: str | None, device_id: str | None) -> dict:
    user = User.objects.filter(phone_number=phone).first()
    created = False
    mode_note = None
    if user is None:
        wanted = role if role in (UserRole.PASSENGER, UserRole.DRIVER) else UserRole.PASSENGER
        user = User.objects.create_user(phone_number=phone, role=wanted)
        created = True
        if wanted == UserRole.DRIVER:
            from apps.drivers.models import Driver

            Driver.objects.get_or_create(user=user)
    if not user.is_active or user.deleted_at:
        raise ApiError("Compte désactivé.", code="account_blocked", status_code=403)
    # Un même compte peut être passager et chauffeur : à la connexion, on ouvre le mode
    # choisi, sauf si une course en cours l'en empêche (on reste alors dans le mode actuel).
    if not created and role in MODES and user.role in MODES and user.role != role:
        mode_note = mode_switch_blocker(user)
        if mode_note is None:
            _apply_mode(user, role)
    result = _issue_for(user, device_id)
    log.info("Connexion %s (créé=%s)", user.id, created, extra={"user_id": str(user.id)})
    return {**result, "created": created, "mode_note": mode_note}


def logout_everywhere(user: User) -> None:
    """Déconnexion à distance (F-02) : révoque tous les tokens émis jusqu'ici."""
    user.tokens_valid_from = timezone.now() + timedelta(seconds=1)
    user.active_device_id = None
    user.save(update_fields=["tokens_valid_from", "active_device_id"])


@transaction.atomic
def anonymize_user(user: User) -> None:
    """F-04 : anonymisation des données personnelles, conservation des transactions."""
    suffix = user.id.hex[:12]
    user.phone_number = f"deleted:{suffix}"
    user.first_name = "Compte"
    user.last_name = "supprimé"
    user.photo_url = None
    user.is_active = False
    user.deleted_at = timezone.now()
    user.active_device_id = None
    user.totp_secret = None
    user.totp_enabled = False
    user.save()
    user.push_subscriptions.all().delete()
    from apps.drivers.models import Driver

    Driver.objects.filter(user=user).update(is_online=False, is_available=False, status="suspended")
    logout_everywhere(user)
