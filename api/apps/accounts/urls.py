from django.urls import path

from . import views

urlpatterns = [
    path("auth/otp/request", views.OtpRequestView.as_view(), name="otp-request"),
    path("auth/otp/verify", views.OtpVerifyView.as_view(), name="otp-verify"),
    path("auth/token/refresh", views.TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
    path("me/push-subscriptions", views.PushSubscriptionView.as_view(), name="push-subscriptions"),
    path("me/uploads", views.UploadRequestView.as_view(), name="upload-request"),
    path("me/uploads/<path:key>", views.local_upload_view, name="local-upload"),
]
