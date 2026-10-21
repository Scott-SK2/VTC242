"""Wallet et grand livre (sections 6.3 et 8). Toute variation de solde passe par ce module,
dans une transaction SQL sous SELECT … FOR UPDATE, avec une ligne wallet_transactions."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.common.exceptions import ApiError, PaymentRequired, Unprocessable
from apps.common.money import ZERO, d, round_franc
from apps.realtime import events

from .models import (
    MobileOperator,
    PaymentMethod,
    PayoutRequest,
    PayoutStatus,
    TransactionStatus,
    TransactionType,
    Wallet,
    WalletTransaction,
)
from .providers import get_provider

log = logging.getLogger("vtc242.payments")


# --- helpers ------------------------------------------------------------------------
def get_wallet(user) -> Wallet:
    wallet, _ = Wallet.objects.get_or_create(user=user)
    return wallet


def _locked(wallet_or_user) -> Wallet:
    if isinstance(wallet_or_user, Wallet):
        return Wallet.objects.select_for_update().get(pk=wallet_or_user.pk)
    wallet = get_wallet(wallet_or_user)
    return Wallet.objects.select_for_update().get(pk=wallet.pk)


def _notify(wallet: Wallet) -> None:
    events.send_to_user(
        wallet.user_id,
        "wallet.updated",
        {
            "balance": str(wallet.balance),
            "reserved_balance": str(wallet.reserved_balance),
            "available": str(wallet.available),
        },
    )


def _ledger(
    wallet: Wallet,
    type_: str,
    amount: Decimal,
    *,
    ride=None,
    status: str = TransactionStatus.COMPLETED,
    method: str = PaymentMethod.WALLET,
    operator: str | None = None,
    phone_number: str | None = None,
    idempotency_key: str | None = None,
    external_reference: str | None = None,
    payload: dict | None = None,
) -> WalletTransaction:
    tx = WalletTransaction.objects.create(
        wallet=wallet,
        ride=ride,
        type=type_,
        status=status,
        amount=d(amount),
        method=method,
        operator=operator,
        phone_number=phone_number,
        idempotency_key=idempotency_key or uuid.uuid4().hex,
        external_reference=external_reference,
        provider_payload=payload or {},
        completed_at=timezone.now() if status == TransactionStatus.COMPLETED else None,
    )
    if status == TransactionStatus.COMPLETED:
        wallet.balance = d(wallet.balance + tx.amount)
    wallet.save(update_fields=["balance", "reserved_balance", "updated_at"])
    return tx


# --- réservation / libération (course) ---------------------------------------------
@transaction.atomic
def reserve(user, amount: Decimal, what: str = "cette course") -> Wallet:
    wallet = _locked(user)
    amount = d(amount)
    if wallet.available < amount:
        raise PaymentRequired(
            f"Solde insuffisant pour réserver {what}.",
            details={"required": str(amount), "available": str(wallet.available)},
        )
    wallet.reserved_balance = d(wallet.reserved_balance + amount)
    wallet.save(update_fields=["reserved_balance", "updated_at"])
    _notify(wallet)
    return wallet


@transaction.atomic
def release(user, amount: Decimal) -> Wallet:
    wallet = _locked(user)
    wallet.reserved_balance = d(max(ZERO, wallet.reserved_balance - d(amount)))
    wallet.save(update_fields=["reserved_balance", "updated_at"])
    _notify(wallet)
    return wallet


# --- règlement de course (section 8.4) ---------------------------------------------
@transaction.atomic
def settle_ride(ride, final_price: Decimal, commission: Decimal) -> dict:
    """Débit du passager (wallet) ou rien (espèces) ; crédit du gain et prélèvement de la
    commission sur le wallet chauffeur. Renvoie {charged, capped, earning, commission}."""
    final_price = d(final_price)
    commission = d(commission)
    result = {"charged": ZERO, "capped": False, "earning": ZERO, "commission": commission}

    if ride.payment_method == PaymentMethod.WALLET:
        pw = _locked(ride.passenger)
        reserved = d(ride.reserved_amount)
        pw.reserved_balance = d(max(ZERO, pw.reserved_balance - reserved))
        charge = final_price
        max_charge = d(pw.balance)  # réservation + disponible = solde total
        if charge > max_charge:
            charge = max(ZERO, max_charge)
            result["capped"] = True
        if charge > ZERO:
            _ledger(pw, TransactionType.RIDE_PAYMENT, -charge, ride=ride)
        else:
            pw.save(update_fields=["reserved_balance", "updated_at"])
        result["charged"] = charge
        _notify(pw)
        earning = d(charge - commission) if charge < final_price else d(final_price - commission)
        dw = _locked(ride.driver.user)
        _ledger(dw, TransactionType.RIDE_EARNING, earning + commission, ride=ride)
        _ledger(dw, TransactionType.COMMISSION, -commission, ride=ride)
        result["earning"] = earning
        _notify(dw)
    else:
        dw = _locked(ride.driver.user)
        _ledger(dw, TransactionType.COMMISSION, -commission, ride=ride, method=PaymentMethod.CASH)
        result["charged"] = ZERO
        result["earning"] = d(final_price - commission)
        _notify(dw)
    return result


# --- prestations hors course : location, covoiturage ------------------------------------
@transaction.atomic
def settle_service(
    payer, payee, amount: Decimal, commission: Decimal, *, kind: str, reference: str
) -> dict:
    """Règlement d'une prestation (location de véhicule, covoiturage) : le montant réservé est
    débité du payeur, le prestataire est crédité du montant moins la commission."""
    amount = d(amount)
    commission = d(min(commission, amount))
    meta = {"kind": kind, "reference": reference}
    pw = _locked(payer)
    pw.reserved_balance = d(max(ZERO, pw.reserved_balance - amount))
    charge = d(min(amount, max(ZERO, pw.balance)))
    if charge > ZERO:
        _ledger(pw, TransactionType.SERVICE_PAYMENT, -charge, payload=meta)
    else:
        pw.save(update_fields=["reserved_balance", "updated_at"])
    _notify(pw)
    earning = d(max(ZERO, charge - commission))
    ow = _locked(payee)
    _ledger(ow, TransactionType.SERVICE_EARNING, charge, payload=meta)
    if commission > ZERO:
        _ledger(ow, TransactionType.COMMISSION, -commission, payload=meta)
    _notify(ow)
    return {
        "charged": charge,
        "capped": charge < amount,
        "earning": earning,
        "commission": commission,
    }


@transaction.atomic
def charge_service_cancellation(
    payer, payee, reserved: Decimal, fee: Decimal, *, kind: str, reference: str
) -> Decimal:
    """Annulation tardive d'une prestation : la réservation est levée, les frais sont débités
    au payeur et reversés intégralement au prestataire."""
    reserved = d(reserved)
    fee = d(fee)
    meta = {"kind": kind, "reference": reference}
    pw = _locked(payer)
    pw.reserved_balance = d(max(ZERO, pw.reserved_balance - reserved))
    fee = d(min(fee, max(ZERO, pw.balance)))
    if fee > ZERO:
        _ledger(pw, TransactionType.CANCELLATION_FEE, -fee, payload=meta)
    else:
        pw.save(update_fields=["reserved_balance", "updated_at"])
    _notify(pw)
    if fee > ZERO:
        ow = _locked(payee)
        _ledger(ow, TransactionType.SERVICE_EARNING, fee, payload=meta)
        _notify(ow)
    return fee


@transaction.atomic
def charge_cancellation(ride, fee: Decimal, driver_share: Decimal) -> Decimal:
    """Frais d'annulation débités au passager, part créditée au chauffeur (section 8.4)."""
    fee = d(fee)
    if fee <= ZERO:
        return ZERO
    pw = _locked(ride.passenger)
    reserved = d(ride.reserved_amount)
    pw.reserved_balance = d(max(ZERO, pw.reserved_balance - reserved))
    fee = min(fee, d(max(ZERO, pw.balance)))
    if fee > ZERO:
        _ledger(pw, TransactionType.CANCELLATION_FEE, -fee, ride=ride)
    else:
        pw.save(update_fields=["reserved_balance", "updated_at"])
    _notify(pw)
    if ride.driver_id and fee > ZERO:
        share = round_franc(fee * driver_share)
        if share > ZERO:
            dw = _locked(ride.driver.user)
            _ledger(dw, TransactionType.RIDE_EARNING, share, ride=ride)
            _notify(dw)
    return fee


@transaction.atomic
def refund(ride, amount: Decimal, actor=None, note: str = "") -> WalletTransaction:
    amount = d(amount)
    if amount <= ZERO:
        raise Unprocessable("Montant de remboursement invalide.", code="invalid_amount")
    pw = _locked(ride.passenger)
    tx = _ledger(
        pw,
        TransactionType.REFUND,
        amount,
        ride=ride,
        payload={"note": note, "by": str(getattr(actor, "id", ""))},
    )
    _notify(pw)
    if ride.driver_id:
        dw = _locked(ride.driver.user)
        _ledger(
            dw,
            TransactionType.ADJUSTMENT,
            -amount,
            ride=ride,
            payload={"note": f"Remboursement litige : {note}"},
        )
        _notify(dw)
    return tx


@transaction.atomic
def adjust(user, amount: Decimal, note: str, actor=None) -> WalletTransaction:
    wallet = _locked(user)
    tx = _ledger(
        wallet,
        TransactionType.ADJUSTMENT,
        d(amount),
        payload={"note": note, "by": str(getattr(actor, "id", ""))},
    )
    _notify(wallet)
    return tx


# --- recharge Mobile Money (section 8.1) -------------------------------------------
def _validate_operator(operator: str) -> None:
    if operator not in MobileOperator.values:
        raise ApiError("Opérateur inconnu (mtn ou airtel).", code="validation_error")


@transaction.atomic
def deposit(
    user, amount: Decimal, operator: str, phone_number: str, idempotency_key: str | None = None
) -> WalletTransaction:
    amount = d(amount)
    _validate_operator(operator)
    if amount < Decimal("100"):
        raise Unprocessable("Montant minimum de recharge : 100 F.", code="amount_too_low")
    key = idempotency_key or uuid.uuid4().hex
    existing = WalletTransaction.objects.filter(idempotency_key=key).first()
    if existing:
        return existing
    wallet = _locked(user)
    tx = _ledger(
        wallet,
        TransactionType.DEPOSIT,
        amount,
        status=TransactionStatus.PENDING,
        operator=operator,
        phone_number=phone_number,
        idempotency_key=key,
    )
    from .tasks import initiate_transaction

    transaction.on_commit(lambda: initiate_transaction.delay(str(tx.id)))
    return tx


# --- retrait chauffeur (section 8.2) -----------------------------------------------
@transaction.atomic
def payout(
    driver, amount: Decimal, operator: str, phone_number: str, idempotency_key: str | None = None
) -> WalletTransaction:
    amount = d(amount)
    _validate_operator(operator)
    zone = driver.zone
    payout_min = zone.payout_min if zone else Decimal("2000")
    daily_cap = zone.payout_daily_cap if zone else Decimal("200000")
    manual_threshold = zone.payout_manual_threshold if zone else Decimal("100000")
    if amount < payout_min:
        raise Unprocessable(
            f"Montant minimum de retrait : {payout_min:.0f} F.",
            code="below_minimum",
            details={"minimum": str(payout_min)},
        )
    today = timezone.now().date()
    already = (
        WalletTransaction.objects.filter(
            wallet__user=driver.user,
            type=TransactionType.PAYOUT,
            created_at__date=today,
            status__in=(TransactionStatus.PENDING, TransactionStatus.COMPLETED),
        ).aggregate(s=Sum("amount"))["s"]
        or ZERO
    )
    if -already + amount > daily_cap:
        raise Unprocessable(
            "Plafond journalier de retrait dépassé.",
            code="daily_cap",
            details={"daily_cap": str(daily_cap), "already": str(-already)},
        )
    key = idempotency_key or uuid.uuid4().hex
    existing = WalletTransaction.objects.filter(idempotency_key=key).first()
    if existing:
        return existing
    wallet = _locked(driver.user)
    if wallet.available < amount:
        raise PaymentRequired(
            "Solde disponible insuffisant.", details={"available": str(wallet.available)}
        )
    # débit immédiat (section 8.2), transaction pending
    tx = _ledger(
        wallet,
        TransactionType.PAYOUT,
        -amount,
        status=TransactionStatus.PENDING,
        operator=operator,
        phone_number=phone_number,
        idempotency_key=key,
    )
    wallet.balance = d(wallet.balance - amount)
    wallet.save(update_fields=["balance", "updated_at"])
    status = PayoutStatus.AWAITING_APPROVAL if amount >= manual_threshold else PayoutStatus.PENDING
    PayoutRequest.objects.create(
        driver=driver,
        amount=amount,
        operator=operator,
        phone_number=phone_number,
        status=status,
        transaction=tx,
    )
    _notify(wallet)
    if status == PayoutStatus.PENDING:
        from .tasks import initiate_transaction

        transaction.on_commit(lambda: initiate_transaction.delay(str(tx.id)))
    return tx


@transaction.atomic
def approve_payout(req: PayoutRequest, actor) -> PayoutRequest:
    req = PayoutRequest.objects.select_for_update().get(pk=req.pk)
    if req.status != PayoutStatus.AWAITING_APPROVAL:
        raise Unprocessable("Ce retrait n'attend pas de validation.", code="invalid_state")
    req.status = PayoutStatus.PENDING
    req.processed_by = actor
    req.save(update_fields=["status", "processed_by", "updated_at"])
    from .tasks import initiate_transaction

    transaction.on_commit(lambda: initiate_transaction.delay(str(req.transaction_id)))
    return req


@transaction.atomic
def reject_payout(req: PayoutRequest, actor, note: str = "") -> PayoutRequest:
    req = (
        PayoutRequest.objects.select_for_update(of=("self",))
        .select_related("transaction")
        .get(pk=req.pk)
    )
    if req.status not in (PayoutStatus.AWAITING_APPROVAL, PayoutStatus.PENDING):
        raise Unprocessable("Ce retrait ne peut plus être rejeté.", code="invalid_state")
    req.status = PayoutStatus.REJECTED
    req.processed_by = actor
    req.processed_at = timezone.now()
    req.note = note
    req.save()
    _fail_and_recredit(req.transaction, f"Rejeté par la finance : {note}")
    return req


# --- transitions de transaction (webhook / polling) ---------------------------------
def _fail_and_recredit(tx: WalletTransaction, reason: str) -> None:
    tx = WalletTransaction.objects.select_for_update().get(pk=tx.pk)
    if tx.status != TransactionStatus.PENDING:
        return
    tx.status = TransactionStatus.FAILED
    tx.failure_reason = reason[:200]
    tx.save(update_fields=["status", "failure_reason", "updated_at"])
    if tx.type == TransactionType.PAYOUT:
        wallet = _locked(tx.wallet)
        wallet.balance = d(wallet.balance - tx.amount)  # amount négatif → recrédit
        wallet.save(update_fields=["balance", "updated_at"])
        _notify(wallet)
        PayoutRequest.objects.filter(transaction=tx).update(
            status=PayoutStatus.FAILED, processed_at=timezone.now()
        )
        from apps.common.push import send_push

        send_push(
            tx.wallet.user, "Retrait échoué", "Votre retrait a échoué, le montant a été recrédité."
        )


@transaction.atomic
def mark_transaction(tx_id, status: str, payload: dict | None = None) -> WalletTransaction | None:
    """Applique un statut opérateur (idempotent : une transaction déjà close est ignorée)."""
    tx = (
        WalletTransaction.objects.select_for_update(of=("self",))
        .select_related("wallet__user")
        .filter(pk=tx_id)
        .first()
    )
    if tx is None or tx.status != TransactionStatus.PENDING:
        return tx
    if payload:
        tx.provider_payload = {**tx.provider_payload, "final": payload}
    if status == "completed":
        tx.status = TransactionStatus.COMPLETED
        tx.completed_at = timezone.now()
        tx.save()
        if tx.type == TransactionType.DEPOSIT:
            wallet = _locked(tx.wallet)
            wallet.balance = d(wallet.balance + tx.amount)
            wallet.save(update_fields=["balance", "updated_at"])
            _notify(wallet)
            from apps.common.push import send_push

            send_push(
                wallet.user,
                "Rechargement réussi",
                f"Votre wallet a été crédité de {tx.amount:.0f} F.",
            )
        elif tx.type == TransactionType.PAYOUT:
            PayoutRequest.objects.filter(transaction=tx).update(
                status=PayoutStatus.COMPLETED, processed_at=timezone.now()
            )
            _notify(get_wallet(tx.wallet.user))
    elif status == "failed":
        _fail_and_recredit(tx, str((payload or {}).get("reason", "Refusé par l'opérateur")))
    elif status == "expired":
        if tx.type == TransactionType.PAYOUT:
            _fail_and_recredit(tx, "Expiré sans confirmation opérateur")
        else:
            tx.status = TransactionStatus.EXPIRED
            tx.save(update_fields=["status", "provider_payload", "updated_at"])
    return tx


def initiate(tx: WalletTransaction) -> None:
    provider = get_provider(tx.operator or "mtn")
    if tx.type == TransactionType.DEPOSIT:
        res = provider.initiate_collection(tx.amount, tx.phone_number or "", tx.idempotency_key)
    else:
        res = provider.initiate_disbursement(-tx.amount, tx.phone_number or "", tx.idempotency_key)
    WalletTransaction.objects.filter(pk=tx.pk).update(
        external_reference=res.external_reference,
        provider_payload={**tx.provider_payload, "initiate": res.payload},
    )
    if res.status == "failed":
        mark_transaction(tx.pk, "failed", {"reason": "Refus à l'initiation"})
    PayoutRequest.objects.filter(transaction=tx).update(status=PayoutStatus.PROCESSING)


def poll_pending() -> int:
    """Sans webhook après 90 s : polling toutes les 30 s ; après 15 min : expired (section 8.1)."""
    now = timezone.now()
    n = 0
    qs = WalletTransaction.objects.filter(
        status=TransactionStatus.PENDING,
        type__in=(TransactionType.DEPOSIT, TransactionType.PAYOUT),
        external_reference__isnull=False,
        created_at__lt=now - timedelta(seconds=settings.DEPOSIT_POLL_AFTER_S),
    )
    for tx in qs:
        if now - tx.created_at > timedelta(seconds=settings.DEPOSIT_EXPIRE_AFTER_S):
            mark_transaction(tx.pk, "expired")
            n += 1
            continue
        if tx.last_polled_at and now - tx.last_polled_at < timedelta(
            seconds=settings.DEPOSIT_POLL_INTERVAL_S
        ):
            continue
        provider = get_provider(tx.operator or "mtn")
        kind = "collection" if tx.type == TransactionType.DEPOSIT else "disbursement"
        status = provider.get_status(tx.external_reference or "", kind)
        WalletTransaction.objects.filter(pk=tx.pk).update(last_polled_at=now)
        if status in ("completed", "failed"):
            mark_transaction(tx.pk, status, {"source": "polling"})
            n += 1
    return n


def handle_webhook(operator: str, headers: dict, body: bytes) -> None:
    """Après vérification de signature, confirme le statut auprès de l'opérateur
    avant de créditer."""
    provider = get_provider(operator)
    event = provider.parse_webhook(headers, body)
    tx = WalletTransaction.objects.filter(external_reference=event.external_reference).first()
    if tx is None:
        log.warning("Webhook %s pour référence inconnue %s", operator, event.external_reference)
        return
    if tx.status != TransactionStatus.PENDING:
        return  # rejoué : ignoré (A-09)
    kind = "collection" if tx.type == TransactionType.DEPOSIT else "disbursement"
    confirmed = provider.get_status(event.external_reference, kind)
    status = confirmed if confirmed in ("completed", "failed") else event.status
    if status in ("completed", "failed"):
        mark_transaction(tx.pk, status, {"source": "webhook", **event.payload})


def recompute_balances() -> list[dict]:
    """Tâche nocturne : recalcul depuis les transactions completed et alerte en cas d'écart."""
    mismatches = []
    for wallet in Wallet.objects.all().iterator():
        total = (
            wallet.transactions.filter(status=TransactionStatus.COMPLETED).aggregate(
                s=Sum("amount")
            )["s"]
            or ZERO
        )
        pending_payouts = (
            wallet.transactions.filter(
                status=TransactionStatus.PENDING, type=TransactionType.PAYOUT
            ).aggregate(s=Sum("amount"))["s"]
            or ZERO
        )
        expected = d(total + pending_payouts)
        if expected != d(wallet.balance):
            mismatches.append(
                {
                    "wallet_id": str(wallet.id),
                    "user_id": str(wallet.user_id),
                    "balance": str(wallet.balance),
                    "expected": str(expected),
                }
            )
    if mismatches:
        log.error("Écarts de solde détectés : %s", mismatches)
        events.send_to_admins("admin.alert", {"type": "balance_mismatch", "payload": mismatches})
    return mismatches
