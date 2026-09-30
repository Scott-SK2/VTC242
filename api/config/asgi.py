import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402

from apps.realtime.middleware import JWTAuthMiddleware  # noqa: E402
from apps.realtime.routing import websocket_urlpatterns  # noqa: E402


def _allowed_ws_origins() -> list[str]:
    """Origines WebSocket : hôtes de l'API + origines CORS (frontend Vercel, previews)."""
    if getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False):
        return ["*"]
    origins = list(settings.ALLOWED_HOSTS)
    origins += [o.split("://", 1)[-1] for o in settings.CORS_ALLOWED_ORIGINS]
    origins += ["*.vercel.app", ".vtc242.cg"]
    return origins


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": OriginValidator(
            JWTAuthMiddleware(URLRouter(websocket_urlpatterns)), _allowed_ws_origins()
        ),
    }
)
