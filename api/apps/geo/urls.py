from django.urls import path

from . import views

urlpatterns = [
    path("geo/autocomplete", views.AutocompleteView.as_view(), name="geo-autocomplete"),
    path("geo/zones/resolve", views.ZoneResolveView.as_view(), name="geo-zone-resolve"),
]
