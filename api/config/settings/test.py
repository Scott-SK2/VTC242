from .base import *  # noqa: F401,F403
from .base import DATABASES, REST_FRAMEWORK

DEBUG = False
SECRET_KEY = "test-secret-key-long-enough-for-hmac-sha256-0123456789"
DATABASES["default"]["NAME"] = "vtc242"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
PAYMENT_PROVIDER_MODE = "sandbox"
SMS_BACKEND = "memory"
DEBUG_OTP_IN_RESPONSE = True
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": ()}
ROUTING_BACKEND = "straight"
GEO_INDEX_BACKEND = "db"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
WHITENOISE_AUTOREFRESH = True
