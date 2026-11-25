from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.common.views import HealthView, MetricsView

api_v1 = [
    path("", include("apps.accounts.urls")),
    path("", include("apps.geo.urls")),
    path("", include("apps.drivers.urls")),
    path("", include("apps.rides.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.rentals.urls")),
    path("", include("apps.carpool.urls")),
    path("admin/", include("apps.backoffice.urls")),
]

urlpatterns = [
    path("api/v1/", include(api_v1)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    path("health/", HealthView.as_view(), name="health"),
    path("metrics", MetricsView.as_view(), name="metrics"),
]
# Admin Django (sans TOTP ni journal d'audit) : seulement en local, ou activée explicitement
if settings.DEBUG or getattr(settings, "DJANGO_ADMIN_ENABLED", True):
    urlpatterns.insert(0, path("django-admin/", admin.site.urls))
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif not settings.R2_BUCKET:
    # Profil de test sans R2 : l'API sert elle-même les fichiers téléversés (noms aléatoires
    # non devinables ; disque éphémère sur Render, voir docs/reste-a-faire.md).
    from apps.common.views import media_view

    urlpatterns += [re_path(r"^media/(?P<path>uploads/.+)$", media_view, name="media")]
