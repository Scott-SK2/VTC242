from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsDriver, IsPassenger, IsPassengerOrDriver

from . import services
from .models import BookingStatus, ListingStatus, RentalBooking, RentalListing, RentalMode
from .serializers import (
    ReasonSerializer,
    RentalBookingInputSerializer,
    RentalBookingSerializer,
    RentalListingInputSerializer,
    RentalListingPatchSerializer,
    RentalListingSerializer,
)


class ListingSearchView(ListAPIView):
    """Catalogue des véhicules disponibles à la location (annonces validées et actives)."""

    permission_classes = (IsAuthenticated,)
    serializer_class = RentalListingSerializer

    def get_queryset(self):
        qs = RentalListing.objects.filter(
            status=ListingStatus.APPROVED, is_active=True
        ).select_related("vehicle", "owner", "owner__driver")
        p = self.request.query_params
        mode = p.get("mode")
        if mode == RentalMode.WITH_DRIVER:
            qs = qs.filter(price_per_day_with_driver__isnull=False)
        elif mode == RentalMode.WITHOUT_DRIVER:
            qs = qs.filter(price_per_day_without_driver__isnull=False)
        if p.get("category"):
            qs = qs.filter(vehicle__category=p["category"])
        if p.get("q"):
            qs = (
                qs.filter(title__icontains=p["q"])
                | qs.filter(vehicle__brand__icontains=p["q"])
                | qs.filter(vehicle__model__icontains=p["q"])
            )
        if p.get("start_date") and p.get("end_date"):
            busy = RentalBooking.objects.filter(
                status__in=(BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS),
                start_date__lte=p["end_date"],
                end_date__gte=p["start_date"],
            ).values_list("listing_id", flat=True)
            qs = qs.exclude(pk__in=busy)
        return qs.distinct()


class ListingDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, listing_id):
        listing = get_object_or_404(
            RentalListing.objects.select_related("vehicle", "owner", "owner__driver"),
            pk=listing_id,
        )
        if not listing.is_bookable and listing.owner_id != request.user.id:
            return Response({"code": "not_found", "message": "Annonce indisponible."}, status=404)
        data = RentalListingSerializer(listing).data
        data["booked_periods"] = services.availability(listing)
        return Response(data)


class MyListingsView(APIView):
    permission_classes = (IsDriver,)

    def get(self, request):
        qs = RentalListing.objects.filter(owner=request.user).select_related(
            "vehicle", "owner", "owner__driver"
        )
        return Response(RentalListingSerializer(qs, many=True).data)

    def post(self, request):
        ser = RentalListingInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        listing = services.create_listing(request.user, ser.validated_data)
        return Response(RentalListingSerializer(listing).data, status=201)


class MyListingDetailView(APIView):
    permission_classes = (IsDriver,)

    def patch(self, request, listing_id):
        listing = get_object_or_404(RentalListing, pk=listing_id, owner=request.user)
        ser = RentalListingPatchSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        listing = services.update_listing(request.user, listing, ser.validated_data)
        return Response(RentalListingSerializer(listing).data)


class BookingListCreateView(ListAPIView):
    """Passager : ses réservations ; chauffeur / loueur : les demandes reçues."""

    permission_classes = (IsPassengerOrDriver,)
    serializer_class = RentalBookingSerializer

    def get_queryset(self):
        user = self.request.user
        qs = RentalBooking.objects.select_related(
            "listing", "listing__vehicle", "listing__owner", "renter", "owner", "owner__driver"
        )
        qs = qs.filter(owner=user) if user.role == "driver" else qs.filter(renter=user)
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status__in=status.split(","))
        return qs

    def post(self, request):
        if not IsPassenger().has_permission(request, self):
            return Response(
                {"code": "forbidden", "message": "Réservé aux passagers.", "details": {}},
                status=403,
            )
        ser = RentalBookingInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        booking = services.create_booking(request.user, ser.validated_data)
        return Response(RentalBookingSerializer(booking).data, status=201)


class BookingDetailView(APIView):
    permission_classes = (IsPassengerOrDriver,)

    def get(self, request, booking_id):
        booking = get_object_or_404(
            RentalBooking.objects.select_related(
                "listing", "listing__vehicle", "listing__owner", "renter", "owner", "owner__driver"
            ),
            pk=booking_id,
        )
        if request.user.id not in (booking.renter_id, booking.owner_id):
            return Response({"code": "not_found", "message": "Introuvable."}, status=404)
        data = RentalBookingSerializer(booking).data
        data["cancellation_fee_preview"] = str(services.cancellation_preview(booking))
        return Response(data)


class BookingActionView(APIView):
    """accept / decline / start / complete / cancel (loueur) — cancel (client)."""

    permission_classes = (IsPassengerOrDriver,)

    def post(self, request, booking_id, action):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        reason = ser.validated_data["reason"]
        if request.user.role == "driver":
            booking = services.owner_action(booking_id, request.user, action, reason)
        elif action == "cancel":
            booking = services.renter_cancel(booking_id, request.user, reason)
        else:
            return Response(
                {"code": "forbidden", "message": "Action réservée au loueur.", "details": {}},
                status=403,
            )
        return Response(RentalBookingSerializer(booking).data)
