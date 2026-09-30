import json

from celery import shared_task

from . import services
from .models import WalletTransaction


@shared_task(name="payments.initiate_transaction", bind=True, max_retries=3, default_retry_delay=10)
def initiate_transaction(self, tx_id: str) -> None:
    tx = WalletTransaction.objects.filter(pk=tx_id).first()
    if tx is None or tx.status != "pending" or tx.external_reference:
        return
    try:
        services.initiate(tx)
    except Exception as exc:  # pragma: no cover - réseau opérateur
        raise self.retry(exc=exc)


@shared_task(name="payments.process_webhook")
def process_webhook(operator: str, headers: dict, body: str) -> None:
    services.handle_webhook(operator, headers, body.encode())


@shared_task(name="payments.poll_pending_transactions")
def poll_pending_transactions() -> int:
    return services.poll_pending()


@shared_task(name="payments.recompute_balances")
def recompute_balances() -> int:
    return len(services.recompute_balances())


@shared_task(name="payments.sandbox_deliver_webhook")
def sandbox_deliver_webhook(operator: str, reference: str, outcome: str) -> None:
    body = json.dumps({"reference": reference, "status": outcome})
    services.handle_webhook(operator, {}, body.encode())
