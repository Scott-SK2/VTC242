"""Réconciliation quotidienne : import CSV des relevés opérateurs (section 8.4, F-59)."""

from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation

from apps.common.money import d

from .models import ReconciliationReport, TransactionStatus, WalletTransaction


def import_statement(operator: str, content: bytes, actor=None) -> ReconciliationReport:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    matched = 0
    mismatched: list[dict] = []
    missing: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        ref = (row.get("external_reference") or row.get("reference") or "").strip()
        if not ref:
            continue
        seen.add(ref)
        try:
            amount = d(Decimal(str(row.get("amount", "0")).replace(" ", "")))
        except InvalidOperation:
            amount = None
        status = (row.get("status") or "").strip().lower()
        tx = WalletTransaction.objects.filter(external_reference=ref).first()
        if tx is None:
            missing.append(
                {
                    "external_reference": ref,
                    "amount": str(amount),
                    "status": status,
                    "side": "vtc242",
                }
            )
            continue
        ours = abs(tx.amount)
        ok_amount = amount is None or amount == ours
        ok_status = (
            status in ("", "success", "successful", "completed", "ts")
            and tx.status == TransactionStatus.COMPLETED
            or (
                status in ("failed", "tf")
                and tx.status in (TransactionStatus.FAILED, TransactionStatus.EXPIRED)
            )
        )
        if ok_amount and ok_status:
            matched += 1
        else:
            mismatched.append(
                {
                    "external_reference": ref,
                    "operator_amount": str(amount),
                    "our_amount": str(ours),
                    "operator_status": status,
                    "our_status": tx.status,
                }
            )
    for tx in WalletTransaction.objects.filter(
        operator=operator, status=TransactionStatus.COMPLETED, external_reference__isnull=False
    ).exclude(external_reference__in=seen)[:500]:
        missing.append(
            {
                "external_reference": tx.external_reference,
                "amount": str(abs(tx.amount)),
                "status": tx.status,
                "side": "operator",
            }
        )
    return ReconciliationReport.objects.create(
        operator=operator,
        imported_by=actor,
        rows_total=len(rows),
        matched=matched,
        mismatched=mismatched,
        missing=missing,
    )
