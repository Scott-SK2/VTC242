from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import AIRTEL, MTN, PAYMENT_PROVIDER_MODE, REST_FRAMEWORK, SECRET_KEY, STORAGES, env

# Garde-fous de démarrage : jamais de clé de signature publique, jamais de paiement réel
# avec des webhooks non signés.
if not SECRET_KEY or SECRET_KEY == "dev-insecure-secret-key-change-me" or len(SECRET_KEY) < 32:
    raise ImproperlyConfigured("SECRET_KEY absente ou trop faible en production.")
if PAYMENT_PROVIDER_MODE == "live" and not (MTN["WEBHOOK_SECRET"] and AIRTEL["WEBHOOK_SECRET"]):
    raise ImproperlyConfigured(
        "PAYMENT_PROVIDER_MODE=live exige MTN_WEBHOOK_SECRET et AIRTEL_WEBHOOK_SECRET."
    )
# Render place un proxy devant l'API : son entrée X-Forwarded-For est la seule fiable
REST_FRAMEWORK["NUM_PROXIES"] = env.int("NUM_PROXIES", default=1) or None
DJANGO_ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=False)

DEBUG = False
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SECURE_REDIRECT_EXEMPT = [r"^health/$", r"^metrics$"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

if env("R2_BUCKET"):
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("R2_BUCKET"),
            "access_key": env("R2_ACCESS_KEY"),
            "secret_key": env("R2_SECRET_KEY"),
            "endpoint_url": f"https://{env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
            "region_name": "auto",
            "signature_version": "s3v4",
            "default_acl": None,
            "querystring_auth": True,
            "querystring_expire": 900,
        },
    }

_sentry_dsn = env("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[DjangoIntegration(), CeleryIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
