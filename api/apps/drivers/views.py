from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsDriver

from . import services
from .models import Driver
from .serializers import (
    DocumentCreateSerializer,
    DriverDocumentSerializer,
    DriverProfileSerializer,
    PositionBatchSerializer,
    StatusSerializer,
    VehicleActivateSerializer,
    VehicleSerializer,
)


def _driver(request) -> Driver:
    driver, _ = Driver.objects.select_related("user", "active_vehicle", "zone").get_or_create(
        user=request.user
    )
    return driver


class DriverMeView(APIView):
    permission_classes = (IsDriver,)

    def get(self, request):
        return Response(DriverProfileSerializer(_driver(request)).data)


class DriverStatusView(APIView):
    permission_classes = (IsDriver,)

    def patch(self, request):
        ser = StatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        driver = services.set_online(_driver(request), ser.validated_data["is_online"])
        return Response(DriverProfileSerializer(driver).data)


class DriverLocationView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request):
        ser = PositionBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        accepted = services.record_positions(_driver(request), ser.validated_data["positions"])
        return Response({"accepted": accepted}, status=202)


class VehicleListView(APIView):
    permission_classes = (IsDriver,)

    def get(self, request):
        driver = _driver(request)
        return Response(VehicleSerializer(driver.vehicles.all(), many=True).data)

    def post(self, request):
        ser = VehicleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        vehicle = services.add_vehicle(_driver(request), ser.validated_data)
        return Response(VehicleSerializer(vehicle).data, status=201)


class VehicleDetailView(APIView):
    permission_classes = (IsDriver,)

    def patch(self, request, vehicle_id):
        driver = _driver(request)
        vehicle = get_object_or_404(driver.vehicles, pk=vehicle_id)
        ser = VehicleActivateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if ser.validated_data["is_active"]:
            services.activate_vehicle(driver, vehicle)
        return Response(VehicleSerializer(vehicle).data)


class DocumentListView(APIView):
    permission_classes = (IsDriver,)

    def get(self, request):
        return Response(DriverDocumentSerializer(_driver(request).documents.all(), many=True).data)

    def post(self, request):
        ser = DocumentCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        doc = services.add_document(_driver(request), d["type"], d["file_url"], d.get("expires_at"))
        return Response(DriverDocumentSerializer(doc).data, status=201)


class CurrentOfferView(APIView):
    permission_classes = (IsDriver,)

    def get(self, request):
        from apps.rides import dispatch

        offer = dispatch.current_offer_for(_driver(request))
        if offer is None:
            return Response(status=204)
        return Response(offer)
