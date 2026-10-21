"""Réglages communs à tous les environnements (section 5, 9 et 11 du cahier des charges)."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173"]),
    CORS_ALLOW_ALL_ORIGINS=(bool, False),
    RENDER_EXTERNAL_HOSTNAME=(str, ""),
    FRONTEND_URL=(str, "http://localhost:5173"),
    PAYMENT_PROVIDER_MODE=(str, "sandbox"),
    SMS_BACKEND=(str, "console"),
    DEBUG_OTP_IN_RESPONSE=(bool, False),
    OSRM_URL=(str, "https://router.project-osrm.org"),
    PHOTON_URL=(str, "https://photon.komoot.io"),
    REDIS_URL=(str, "redis://localhost:6379/0"),
    SENTRY_DSN=(str, ""),
    VAPID_PRIVATE_KEY=(str, ""),
    VAPID_PUBLIC_KEY=(str, ""),
    VAPID_CLAIMS_EMAIL=(str, "mailto:support@vtc242.cg"),
    INFOBIP_API_KEY=(str, ""),
    INFOBIP_BASE_URL=(str, ""),
    INFOBIP_SENDER=(str, "VTC242"),
    R2_ACCOUNT_ID=(str, ""),
    R2_ACCESS_KEY=(str, ""),
    R2_SECRET_KEY=(str, ""),
    R2_BUCKET=(str, ""),
    MTN_API_USER=(str, ""),
    MTN_API_KEY=(str, ""),
    MTN_SUBSCRIPTION_KEY=(str, ""),
    MTN_ENV=(str, "sandbox"),
    MTN_BASE_URL=(str, "https://sandbox.momodeveloper.mtn.com"),
    MTN_WEBHOOK_SECRET=(str, ""),
    AIRTEL_CLIENT_ID=(str, ""),
    AIRTEL_CLIENT_SECRET=(str, ""),
    AIRTEL_ENV=(str, "sandbox"),
    AIRTEL_BASE_URL=(str, "https://openapiuat.airtel.africa"),
    AIRTEL_WEBHOOK_SECRET=(str, ""),
    PAYMENT_WEBHOOK_ALLOWED_IPS=(list, []),
    API_BASE_URL=(str, "http://localhost:8000"),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY", default="dev-insecure-secret-key-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
FRONTEND_URL = env("FRONTEND_URL")
API_BASE_URL = env("API_BASE_URL")

INSTALLED_APPS = [
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "rest_framework_simplejwt.token_blacklist",
    "apps.common",
    "apps.accounts",
    "apps.geo",
    "apps.drivers",
    "apps.rides",
    "apps.payments",
    "apps.safety",
    "apps.realtime",
    "apps.backoffice",
]

MIDDLEWARE = [
    "django.middleware.gzip.GZipMiddleware",  # réponses JSON compressées (3G/4G)
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "csp.middleware.CSPMiddleware",
    "apps.common.middleware.MetricsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgis://vtc242:vtc242@localhost:5432/vtc242",
    )
}
DATABASES["default"]["ENGINE"] = "django.contrib.gis.db.backends.postgis"
DATABASES["default"]["CONN_MAX_AGE"] = 60

# Schéma Postgres dédié (ex. base partagée avec une autre application en phase de test) :
# toutes les tables de VTC 242, django_migrations compris, vivent dans ce schéma, et le
# search_path n'inclut PAS public : aucun repli possible sur les tables de l'autre application.
# DATABASE_EXTRA_SEARCH_PATH (liste séparée par des virgules) n'est nécessaire que si PostGIS
# est déjà installé dans un autre schéma de la base (ensure_schema l'indique).
DATABASE_SCHEMA = env("DATABASE_SCHEMA", default="").strip()
DATABASE_EXTRA_SEARCH_PATH = [
    s.strip() for s in env("DATABASE_EXTRA_SEARCH_PATH", default="").split(",") if s.strip()
]
if DATABASE_SCHEMA:
    for _name in [DATABASE_SCHEMA, *DATABASE_EXTRA_SEARCH_PATH]:
        if not _name.replace("_", "").isalnum():
            raise ValueError("DATABASE_SCHEMA : identifiant simple attendu (lettres, chiffres, _).")
    DATABASES["default"].setdefault("OPTIONS", {})["options"] = "-c search_path=" + ",".join(
        [DATABASE_SCHEMA, *DATABASE_EXTRA_SEARCH_PATH]
    )

REDIS_URL = env("REDIS_URL")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL], "capacity": 2000},
    }
}

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = None
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = "Africa/Brazzaville"
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BEAT_SCHEDULE = {
    "payments-poll-pending": {
        "task": "payments.poll_pending_transactions",
        "schedule": 30.0,
    },
    "rides-expire-offers": {"task": "rides.expire_offers", "schedule": 5.0},
    "rides-dispatch-watchdog": {"task": "rides.dispatch_watchdog", "schedule": 15.0},
    "drivers-position-watchdog": {"task": "drivers.position_watchdog", "schedule": 10.0},
    "payments-recompute-balances": {
        "task": "payments.recompute_balances",
        "schedule": 24 * 3600.0,
    },
    "accounts-purge-otp": {"task": "accounts.purge_expired_otp", "schedule": 3600.0},
    "rides-purge-positions": {"task": "rides.purge_old_positions", "schedule": 24 * 3600.0},
    "backoffice-broadcast": {"task": "backoffice.broadcast_dashboard", "schedule": 5.0},
    "backoffice-business-watch": {"task": "backoffice.business_watch", "schedule": 300.0},
}

AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("apps.accounts.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_PARSER_CLASSES": (
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.CursorPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "apps.common.exceptions.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": ("apps.common.throttling.UserBurstThrottle",),
    "DEFAULT_THROTTLE_RATES": {"user_burst": "60/min", "otp": "20/hour", "start": "10/min"},
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_OBTAIN_SERIALIZER": "rest_framework_simplejwt.serializers.TokenObtainPairSerializer",
}
ADMIN_SESSION_LIFETIME = timedelta(hours=8)

SPECTACULAR_SETTINGS = {
    "TITLE": "VTC 242 API",
    "DESCRIPTION": "API REST de l'application VTC 242 (Brazzaville).",
    "VERSION": "1.0.0",
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_ALL_ORIGINS = env("CORS_ALLOW_ALL_ORIGINS")  # test en ligne uniquement
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https://vtc242-web(-[\w-]+)?\.vercel\.app$"]
CORS_ALLOW_CREDENTIALS = True
# L'en-tête Idempotency-Key (POST /rides, /wallet/*) doit être autorisé au préflight CORS
from corsheaders.defaults import default_headers as _cors_default_headers  # noqa: E402

CORS_ALLOW_HEADERS = [*_cors_default_headers, "idempotency-key"]

# Hôte public injecté par Render (ex. vtc242-api.onrender.com)
_render_host = env("RENDER_EXTERNAL_HOSTNAME")
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)

CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": ("'self'",),
        "img-src": ("'self'", "data:", "https:"),
        "script-src": ("'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"),
        "style-src": (
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
            "https://fonts.googleapis.com",
        ),
        "font-src": ("'self'", "https://fonts.gstatic.com"),
        "connect-src": ("'self'",),
    }
}

LANGUAGE_CODE = "fr"
TIME_ZONE = "Africa/Brazzaville"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Paramètres métier ---------------------------------------------------------------
OTP_LENGTH = 6
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 3
OTP_LOCK_SECONDS = 15 * 60
OTP_MAX_SENDS_PER_WINDOW = 3
OTP_SEND_WINDOW_SECONDS = 15 * 60

RIDE_OTP_MAX_ATTEMPTS = 3
RIDE_PROXIMITY_RADIUS_M = 200
RIDE_DISPUTE_WINDOW_HOURS = 24
RIDE_ESTIMATE_SPREAD = 0.10
RIDE_ROUNDING_XAF = 100

# Durée d'une offre chauffeur (15 s selon le cahier des charges ; ajustable par l'exploitant)
DISPATCH_OFFER_TTL_S = env.int("DISPATCH_OFFER_TTL_S", default=15)
DISPATCH_MAX_OFFERS = env.int("DISPATCH_MAX_OFFERS", default=5)
DISPATCH_MAX_DURATION_S = env.int(
    "DISPATCH_MAX_DURATION_S", default=max(120, DISPATCH_OFFER_TTL_S * DISPATCH_MAX_OFFERS + 30)
)
DISPATCH_RADII_M = (2000, 4000, 6000)
# Sans décision du passager après « aucun chauffeur », annulation et libération automatiques
NO_DRIVER_AUTO_CANCEL_S = env.int("NO_DRIVER_AUTO_CANCEL_S", default=30 * 60)
DISPATCH_DECLINES_BEFORE_PAUSE = 3
DISPATCH_PAUSE_SECONDS = 120

POSITION_MAX_ACCURACY_M = 100
POSITION_LOST_AFTER_S = 30
POSITION_BROADCAST_MIN_INTERVAL_S = 3
DEVIATION_ALERT_INTERVAL_S = 120
DETOUR_GRACE_S = 300
ROUTE_SAMPLE_STEP_M = 50

TRIP_SHARE_EXPIRY_AFTER_END_H = 2
POSITIONS_RETENTION_DAYS = 90
CHAT_RETENTION_DAYS = 365

DEPOSIT_POLL_AFTER_S = 90
DEPOSIT_POLL_INTERVAL_S = 30
DEPOSIT_EXPIRE_AFTER_S = 15 * 60
IDEMPOTENCY_TTL_S = 24 * 3600

PAYMENT_PROVIDER_MODE = env("PAYMENT_PROVIDER_MODE")
# Adresses / réseaux (CIDR) autorisés à appeler les webhooks ; vide = pas de filtrage IP
# (la signature HMAC reste vérifiée dans tous les cas)
PAYMENT_WEBHOOK_ALLOWED_IPS = env("PAYMENT_WEBHOOK_ALLOWED_IPS")
SMS_BACKEND = env("SMS_BACKEND")
# SMS « chauffeur trouvé + code de départ » (complément du push, cahier des charges section 2) ;
# désactivable pour limiter le coût SMS si le push suffit.
RIDE_SMS_ENABLED = env.bool("RIDE_SMS_ENABLED", default=True)
DEBUG_OTP_IN_RESPONSE = env("DEBUG_OTP_IN_RESPONSE")
OSRM_URL = env("OSRM_URL")
PHOTON_URL = env("PHOTON_URL")
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY")
VAPID_CLAIMS_EMAIL = env("VAPID_CLAIMS_EMAIL")
INFOBIP_API_KEY = env("INFOBIP_API_KEY")
INFOBIP_BASE_URL = env("INFOBIP_BASE_URL")
INFOBIP_SENDER = env("INFOBIP_SENDER")

R2_ACCOUNT_ID = env("R2_ACCOUNT_ID")
R2_ACCESS_KEY = env("R2_ACCESS_KEY")
R2_SECRET_KEY = env("R2_SECRET_KEY")
R2_BUCKET = env("R2_BUCKET")
UPLOAD_MAX_BYTES = 10 * 1024 * 1024
UPLOAD_ALLOWED_TYPES = ("image/jpeg", "image/png", "application/pdf")

MTN = {
    "API_USER": env("MTN_API_USER"),
    "API_KEY": env("MTN_API_KEY"),
    "SUBSCRIPTION_KEY": env("MTN_SUBSCRIPTION_KEY"),
    "ENV": env("MTN_ENV"),
    "BASE_URL": env("MTN_BASE_URL"),
    "WEBHOOK_SECRET": env("MTN_WEBHOOK_SECRET"),
    "TARGET_ENVIRONMENT": "mtncongo" if env("MTN_ENV") == "live" else "sandbox",
}
AIRTEL = {
    "CLIENT_ID": env("AIRTEL_CLIENT_ID"),
    "CLIENT_SECRET": env("AIRTEL_CLIENT_SECRET"),
    "ENV": env("AIRTEL_ENV"),
    "BASE_URL": env("AIRTEL_BASE_URL"),
    "WEBHOOK_SECRET": env("AIRTEL_WEBHOOK_SECRET"),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "apps.common.logging.JsonFormatter"},
        "plain": {"format": "%(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "json"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"level": "WARNING"},
        "vtc242": {"level": "INFO"},
    },
}
