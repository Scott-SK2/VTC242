from django.urls import path

from . import views

urlpatterns = [
    path("rentals/listings", views.ListingSearchView.as_view(), name="rental-listings"),
    path(
        "rentals/listings/<uuid:listing_id>",
        views.ListingDetailView.as_view(),
        name="rental-listing",
    ),
    path("rentals/my/listings", views.MyListingsView.as_view(), name="rental-my-listings"),
    path(
        "rentals/my/listings/<uuid:listing_id>",
        views.MyListingDetailView.as_view(),
        name="rental-my-listing",
    ),
    path("rentals/bookings", views.BookingListCreateView.as_view(), name="rental-bookings"),
    path(
        "rentals/bookings/<uuid:booking_id>",
        views.BookingDetailView.as_view(),
        name="rental-booking",
    ),
    path(
        "rentals/bookings/<uuid:booking_id>/<slug:action>",
        views.BookingActionView.as_view(),
        name="rental-booking-action",
    ),
]
