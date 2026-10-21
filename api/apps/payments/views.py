from __future__ import annotations

from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.idempotency import idempotent
from apps.common.permissions import IsDriver, IsPassengerOrDriver

from . import services
from .serializers import (
    DepositSerializer,
    PayoutSerializer,
    TransactionSerializer,
    WalletSerializer,
)
from .tasks import process_webhook


class WalletView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def get(self, request):
        wallet = services.get_wallet(request.user)
        data = {
            "balance": wallet.balance,
            "reserved_balance": wallet.reserved_balance,
            "available": wallet.available,
            "currency": wallet.currency,
        }
        driver = getattr(request.user, "driver", None)
        if driver is not None:
            zone = driver.zone
            data["cash_debt_limit"] = zone.cash_debt_limit if zone else -5000
            data["payout_min"] = zone.payout_min if zone else 2000
            data["payout_daily_cap"] = zone.payout_daily_cap if zone else 200000
        return Response(WalletSerializer(data).data)


class TransactionListView(ListAPIView):
    permission_classes = (IsPassengerOrDriver,)
    serializer_class = TransactionSerializer

    def get_queryset(self):
        return services.get_wallet(self.request.user).transactions.select_related("ride").all()


class DepositView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    @idempotent
    def post(self, request):
        ser = DepositSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        tx = services.deposit(
            request.user,
            d["amount"],
            d["operator"],
            d["phone_number"],
            request.headers.get("Idempotency-Key"),
        )
        return Response(TransactionSerializer(tx).data, status=202)


class PayoutView(APIView):
    permission_classes = (IsDriver,)

    @idempotent
    def post(self, request):
        ser = PayoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        tx = services.payout(
            request.user.driver,
            d["amount"],
            d["operator"],
            d["phone_number"],
            request.headers.get("Idempotency-Key"),
        )
        return Response(TransactionSerializer(tx).data, status=202)


def _client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _webhook_ip_allowed(request) -> bool:
    """Liste blanche IP / CIDR des serveurs opérateurs (PAYMENT_WEBHOOK_ALLOWED_IPS)."""
    import ipaddress
    import logging

    allowed = settings.PAYMENT_WEBHOOK_ALLOWED_IPS
    if not allowed:
        return True
    ip = _client_ip(request)
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for item in allowed:
        try:
            if addr in ipaddress.ip_network(item.strip(), strict=False):
                return True
        except ValueError:
            continue
    logging.getLogger("vtc242.payments").warning("Webhook refusé : IP %s hors liste blanche", ip)
    return False


class WebhookView(APIView):
    """Réponse 200 immédiate, traitement asynchrone (section 8.1)."""

    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = ()
    parser_classes = ()

    def post(self, request, operator: str):
        if operator not in ("mtn", "airtel"):
            return Response(status=404)
        if not _webhook_ip_allowed(request):
            return Response(status=403)
        headers = {k: v for k, v in request.headers.items()}
        process_webhook.delay(operator, headers, request.body.decode("utf-8", "ignore"))
        return Response({"received": True})


webhook_view = csrf_exempt(WebhookView.as_view())
