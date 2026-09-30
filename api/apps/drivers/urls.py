from django.urls import path

from . import views

urlpatterns = [
    path("drivers/me", views.DriverMeView.as_view(), name="driver-me"),
    path("drivers/me/status", views.DriverStatusView.as_view(), name="driver-status"),
    path("drivers/me/location", views.DriverLocationView.as_view(), name="driver-location"),
    path("drivers/me/vehicles", views.VehicleListView.as_view(), name="driver-vehicles"),
    path(
        "drivers/me/vehicles/<uuid:vehicle_id>",
        views.VehicleDetailView.as_view(),
        name="driver-vehicle",
    ),
    path("drivers/me/documents", views.DocumentListView.as_view(), name="driver-documents"),
    path(
        "drivers/me/offers/current", views.CurrentOfferView.as_view(), name="driver-current-offer"
    ),
]
