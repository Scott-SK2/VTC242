from .base import *  # noqa: F401,F403
from .base import LOGGING

DEBUG = True
ALLOWED_HOSTS = ["*"]
DEBUG_OTP_IN_RESPONSE = True
LOGGING["handlers"]["console"]["formatter"] = "plain"
CORS_ALLOW_ALL_ORIGINS = True
CSP_CONNECT_SRC = ("'self'", "http://localhost:5173", "ws://localhost:8000")
