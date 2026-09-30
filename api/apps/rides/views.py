from __future__ import annotations

from typing import cast

from django.conf import settings
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.common.exceptions import Forbidden
from apps.common.idempotency import idempotent
from apps.common.permissions import IsDriver, IsPassenger, IsPassengerOrDriver
from apps.common.throttling import RideStartThrottle

from . import services
from .models import ACTIVE_STATUSES, Ride
from .serializers import (
    DisputeSerializer,
    EmergencySerializer,
    EstimateRequestSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    PositionBodySerializer,
    RateSerializer,
    ReasonSerializer,
    RideCreateSerializer,
    RideSerializer,
    StartSerializer,
)


def _ride_response(ride, request, status=200):
    ride = services.get_ride_for(request.user, ride.id)
    return Response(
        RideSerializer(ride, context={"role": request.user.role, "user": request.user}).data,
        status=status,
    )


class EstimateView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request):
        ser = EstimateRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(
            services.estimate(ser.validated_data["pickup"], ser.validated_data["dropoff"])
        )


class RideListCreateView(ListAPIView):
    permission_classes = (IsPassengerOrDriver,)
    serializer_class = RideSerializer

    def get_serializer_context(self):
        return {
            **super().get_serializer_context(),
            "role": cast(User, self.request.user).role,
            "user": self.request.user,
        }

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = Ride.objects.select_related(
            "driver__user", "vehicle", "passenger", "zone", "pricing_rule"
        )
        if user.role == "passenger":
            qs = qs.filter(passenger=user)
        else:
            qs = qs.filter(driver=user.driver)
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status__in=[s.strip() for s in status.split(",")])
        if self.request.query_params.get("active"):
            qs = qs.filter(status__in=ACTIVE_STATUSES)
        return qs.order_by("-requested_at")

    @idempotent
    def post(self, request):
        if request.user.role != "passenger":
            raise Forbidden("Seul un passager peut commander.")
        ser = RideCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ride = services.create_ride(request.user, ser.validated_data)
        return _ride_response(ride, request, status=201)


class RideDetailView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def get(self, request, ride_id):
        ride = services.get_ride_for(request.user, ride_id)
        return Response(
            RideSerializer(ride, context={"role": request.user.role, "user": request.user}).data
        )


class CancelView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def post(self, request, ride_id):
        services.get_ride_for(request.user, ride_id)
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ride = services.cancel(ride_id, request.user, ser.validated_data["reason"])
        return _ride_response(ride, request)


class AcceptView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, ride_id):
        ride = services.accept(ride_id, request.user.driver)
        return _ride_response(ride, request)


class DeclineView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, ride_id):
        services.decline(ride_id, request.user.driver)
        return Response(status=204)


class ArriveView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, ride_id):
        ser = PositionBodySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if d.get("lat") is None or d.get("lng") is None:
            drv = request.user.driver
            if drv.current_location is None:
                from apps.common.exceptions import Unprocessable

                raise Unprocessable("Position requise.", code="position_required")
            d = {"lat": drv.current_location.y, "lng": drv.current_location.x}
        ride = services.arrive(ride_id, request.user.driver, d["lat"], d["lng"])
        return _ride_response(ride, request)


class StartView(APIView):
    permission_classes = (IsDriver,)
    throttle_classes = (RideStartThrottle,) if not settings.DEBUG else ()

    def post(self, request, ride_id):
        ser = StartSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        ride = services.start(
            ride_id, request.user.driver, d["otp_code"], d.get("lat"), d.get("lng")
        )
        return _ride_response(ride, request)


class DetourView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, ride_id):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ride = services.report_detour(
            ride_id, request.user.driver, ser.validated_data["reason"] or "Route barrée"
        )
        return _ride_response(ride, request)


class CompleteView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, ride_id):
        ser = PositionBodySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        lat, lng = d.get("lat"), d.get("lng")
        if lat is None and request.user.driver.current_location is not None:
            lat, lng = (
                request.user.driver.current_location.y,
                request.user.driver.current_location.x,
            )
        ride = services.complete(ride_id, request.user.driver, lat, lng)
        return _ride_response(ride, request)


class ConfirmArrivalView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request, ride_id):
        ride = services.confirm_arrival(ride_id, request.user)
        return _ride_response(ride, request)


class RateView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def post(self, request, ride_id):
        ser = RateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rating = services.rate(
            ride_id, request.user, ser.validated_data["score"], ser.validated_data["comment"]
        )
        return Response({"score": rating.score, "comment": rating.comment}, status=201)


class DisputeView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request, ride_id):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dispute = services.open_dispute(
            ride_id, request.user, ser.validated_data["reason"] or "Contestation"
        )
        return Response(DisputeSerializer(dispute).data, status=201)


class MessagesView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def get(self, request, ride_id):
        ride = services.get_ride_for(request.user, ride_id)
        return Response(
            {
                "results": MessageSerializer(ride.messages.all(), many=True).data,
                "presets": services.CHAT_PRESETS,
            }
        )

    def post(self, request, ride_id):
        ride = services.get_ride_for(request.user, ride_id)
        ser = MessageCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        msg = services.send_message(
            ride, request.user, ser.validated_data.get("body"), ser.validated_data.get("preset")
        )
        return Response(MessageSerializer(msg).data, status=201)


class ShareView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request, ride_id):
        ride = services.get_ride_for(request.user, ride_id)
        share = services.create_share(ride)
        return Response(
            {
                "token": share.token,
                "url": f"{settings.FRONTEND_URL}/share/{share.token}",
                "expires_at": share.expires_at,
            },
            status=201,
        )


class PublicShareView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def get(self, request, token):
        return Response(services.share_payload(token))


class EmergencyView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def post(self, request, ride_id):
        from apps.safety import services as safety

        ride = services.get_ride_for(request.user, ride_id)
        ser = EmergencySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        call = safety.emergency(request.user, ride, d["number_called"], d.get("lat"), d.get("lng"))
        return Response({"id": str(call.id), "occurred_at": call.occurred_at}, status=201)


class ReceiptView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def get(self, request, ride_id):
        from .receipts import build_receipt_pdf

        ride = services.get_ride_for(request.user, ride_id)
        pdf = build_receipt_pdf(ride)
        from django.http import HttpResponse

        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="recu-vtc242-{str(ride.id)[:8]}.pdf"'
        return resp
