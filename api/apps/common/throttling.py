from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class UserBurstThrottle(UserRateThrottle):
    scope = "user_burst"


class OtpRequestThrottle(AnonRateThrottle):
    """Garde-fou par numéro (la règle exacte 3 envois / 15 min est appliquée
    dans accounts.services)."""

    scope = "otp"

    def get_cache_key(self, request, view):
        phone = (request.data or {}).get("phone_number") or self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": phone}


class RideStartThrottle(UserRateThrottle):
    scope = "start"
