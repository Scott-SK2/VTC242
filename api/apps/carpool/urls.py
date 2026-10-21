from django.urls import path

from . import views

urlpatterns = [
    path("carpool/trips", views.TripSearchView.as_view(), name="carpool-trips"),
    path("carpool/trips/publish", views.TripCreateView.as_view(), name="carpool-publish"),
    path("carpool/my/trips", views.MyTripsView.as_view(), name="carpool-my-trips"),
    path("carpool/trips/<uuid:trip_id>", views.TripDetailView.as_view(), name="carpool-trip"),
    path("carpool/trips/<uuid:trip_id>/book", views.TripBookView.as_view(), name="carpool-book"),
    path(
        "carpool/trips/<uuid:trip_id>/<slug:action>",
        views.TripActionView.as_view(),
        name="carpool-trip-action",
    ),
    path("carpool/bookings", views.MyBookingsView.as_view(), name="carpool-bookings"),
    path(
        "carpool/bookings/<uuid:booking_id>/cancel",
        views.BookingCancelView.as_view(),
        name="carpool-booking-cancel",
    ),
]
