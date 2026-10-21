import logging

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

log = logging.getLogger("vtc242.throttle")


class FailOpenMixin:
    """Si le cache (Redis) est injoignable, on laisse passer la requête au lieu de répondre
    500 : l'application reste utilisable en mode dégradé (la règle stricte des OTP,
    3 envois / 15 min, est de toute façon appliquée en base par accounts.services)."""

    def allow_request(self, request, view):  # type: ignore[override]
        try:
            return super().allow_request(request, view)  # type: ignore[misc]
        except Exception:  # noqa: BLE001 - toute panne du cache
            log.warning("Cache de limitation indisponible : requête autorisée", exc_info=True)
            return True


class UserBurstThrottle(FailOpenMixin, UserRateThrottle):
    scope = "user_burst"


class OtpRequestThrottle(FailOpenMixin, AnonRateThrottle):
    """Garde-fou par numéro (la règle exacte 3 envois / 15 min est appliquée
    dans accounts.services)."""

    scope = "otp"

    def get_cache_key(self, request, view):
        phone = (request.data or {}).get("phone_number") or self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": phone}


class RideStartThrottle(FailOpenMixin, UserRateThrottle):
    scope = "start"
