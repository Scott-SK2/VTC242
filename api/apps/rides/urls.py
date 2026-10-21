from django.urls import path

from . import views

urlpatterns = [
    path("rides/estimate", views.EstimateView.as_view(), name="ride-estimate"),
    path("rides", views.RideListCreateView.as_view(), name="ride-list"),
    path("rides/<uuid:ride_id>", views.RideDetailView.as_view(), name="ride-detail"),
    path("rides/<uuid:ride_id>/cancel", views.CancelView.as_view(), name="ride-cancel"),
    path("rides/<uuid:ride_id>/retry", views.RetrySearchView.as_view(), name="ride-retry"),
    path("rides/<uuid:ride_id>/accept", views.AcceptView.as_view(), name="ride-accept"),
    path("rides/<uuid:ride_id>/decline", views.DeclineView.as_view(), name="ride-decline"),
    path("rides/<uuid:ride_id>/arrive", views.ArriveView.as_view(), name="ride-arrive"),
    path("rides/<uuid:ride_id>/start", views.StartView.as_view(), name="ride-start"),
    path("rides/<uuid:ride_id>/detour", views.DetourView.as_view(), name="ride-detour"),
    path("rides/<uuid:ride_id>/complete", views.CompleteView.as_view(), name="ride-complete"),
    path(
        "rides/<uuid:ride_id>/confirm-arrival",
        views.ConfirmArrivalView.as_view(),
        name="ride-confirm-arrival",
    ),
    path("rides/<uuid:ride_id>/rate", views.RateView.as_view(), name="ride-rate"),
    path("rides/<uuid:ride_id>/dispute", views.DisputeView.as_view(), name="ride-dispute"),
    path("rides/<uuid:ride_id>/messages", views.MessagesView.as_view(), name="ride-messages"),
    path("rides/<uuid:ride_id>/share", views.ShareView.as_view(), name="ride-share"),
    path("rides/<uuid:ride_id>/emergency", views.EmergencyView.as_view(), name="ride-emergency"),
    path("rides/<uuid:ride_id>/receipt", views.ReceiptView.as_view(), name="ride-receipt"),
    path("share/<str:token>", views.PublicShareView.as_view(), name="ride-share-public"),
]
