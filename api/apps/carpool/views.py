from __future__ import annotations

from django.contrib.gis.measure import D
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.geo import point
from apps.common.pagination import CursorPagination
from apps.common.permissions import IsDriver, IsPassenger

from . import services
from .models import CarpoolBooking, TripStatus
from .serializers import (
    CarpoolBookingSerializer,
    CarpoolBookInputSerializer,
    CarpoolTripInputSerializer,
    CarpoolTripSerializer,
    ReasonSerializer,
)


class TripPagination(CursorPagination):
    ordering = "departure_at"


class TripSearchView(ListAPIView):
    """Trajets à venir avec des places ; filtres : texte (q), date (YYYY-MM-DD),
    proximité du départ (from_lat / from_lng, 10 km) et de l'arrivée (to_lat / to_lng)."""

    permission_classes = (IsAuthenticated,)
    serializer_class = CarpoolTripSerializer
    pagination_class = TripPagination

    def get_queryset(self):
        p = self.request.query_params
        qs = services.trips_queryset().filter(
            status=TripStatus.PUBLISHED, departure_at__gt=timezone.now()
        )
        if p.get("q"):
            qs = qs.filter(origin_address__icontains=p["q"]) | qs.filter(
                destination_address__icontains=p["q"]
            )
        if p.get("date"):
            qs = qs.filter(departure_at__date=p["date"])
        try:
            if p.get("from_lat") and p.get("from_lng"):
                qs = qs.filter(
                    origin_location__distance_lte=(
                        point(float(p["from_lat"]), float(p["from_lng"])),
                        D(km=10),
                    )
                )
            if p.get("to_lat") and p.get("to_lng"):
                qs = qs.filter(
                    destination_location__distance_lte=(
                        point(float(p["to_lat"]), float(p["to_lng"])),
                        D(km=10),
                    )
                )
        except ValueError:
            pass
        return qs.distinct()

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # les trajets complets restent visibles mais signalés (seats_available = 0)
        return response


class TripCreateView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request):
        ser = CarpoolTripInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        trip = services.publish_trip(request.user, ser.validated_data)
        trip = services.trips_queryset().get(pk=trip.pk)
        return Response(CarpoolTripSerializer(trip).data, status=201)


class MyTripsView(ListAPIView):
    permission_classes = (IsDriver,)
    serializer_class = CarpoolTripSerializer
    pagination_class = TripPagination

    def get_queryset(self):
        qs = services.trips_queryset().filter(driver=self.request.user)
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status__in=status.split(","))
        return qs.order_by("-departure_at")


class TripDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, trip_id):
        trip = get_object_or_404(services.trips_queryset(), pk=trip_id)
        data = CarpoolTripSerializer(trip).data
        if trip.driver_id == request.user.id:
            data["bookings"] = CarpoolBookingSerializer(
                trip.bookings.select_related("passenger").order_by("created_at"), many=True
            ).data
            for b in data["bookings"]:
                b.pop("trip", None)
        else:
            mine = trip.bookings.filter(passenger=request.user).order_by("-created_at").first()
            data["my_booking"] = CarpoolBookingSerializer(mine).data if mine else None
            if data["my_booking"]:
                data["my_booking"].pop("trip", None)
                data["my_booking"]["cancellation_fee_preview"] = str(
                    services.cancellation_preview(mine)
                )
        return Response(data)


class TripActionView(APIView):
    permission_classes = (IsDriver,)

    def post(self, request, trip_id, action):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        trip = services.driver_action(trip_id, request.user, action, ser.validated_data["reason"])
        trip = services.trips_queryset().get(pk=trip.pk)
        return Response(CarpoolTripSerializer(trip).data)


class TripBookView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request, trip_id):
        ser = CarpoolBookInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        booking = services.book(trip_id, request.user, ser.validated_data["seats"])
        booking = CarpoolBooking.objects.select_related("passenger").get(pk=booking.pk)
        booking.trip = services.trips_queryset().get(pk=booking.trip_id)
        return Response(CarpoolBookingSerializer(booking).data, status=201)


class MyBookingsView(ListAPIView):
    permission_classes = (IsPassenger,)
    serializer_class = CarpoolBookingSerializer

    def get_queryset(self):
        qs = (
            CarpoolBooking.objects.filter(passenger=self.request.user)
            .select_related(
                "passenger", "trip", "trip__driver", "trip__driver__driver", "trip__vehicle"
            )
            .prefetch_related("trip__bookings")
        )
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status__in=status.split(","))
        return qs


class BookingCancelView(APIView):
    permission_classes = (IsPassenger,)

    def post(self, request, booking_id):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        booking = services.passenger_cancel(booking_id, request.user, ser.validated_data["reason"])
        booking.trip = services.trips_queryset().get(pk=booking.trip_id)
        return Response(CarpoolBookingSerializer(booking).data)
