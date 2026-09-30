"""JWT (simplejwt) avec révocation globale (tokens_valid_from) et appareil unique chauffeur."""

from __future__ import annotations

from datetime import UTC, datetime

from rest_framework_simplejwt.authentication import JWTAuthentication as BaseJWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User, UserRole


def issue_tokens(user: User, device_id: str | None = None, totp_ok: bool = False) -> dict:
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    refresh["totp"] = totp_ok
    if device_id:
        refresh["device"] = device_id
    access = refresh.access_token
    return {"access": str(access), "refresh": str(refresh)}


class JWTAuthentication(BaseJWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not user.is_active or user.deleted_at is not None:
            raise AuthenticationFailed("Compte inactif.", code="inactive")
        iat = validated_token.get("iat")
        if iat is not None and user.tokens_valid_from:
            issued = datetime.fromtimestamp(int(iat), tz=UTC)
            if issued < user.tokens_valid_from.replace(microsecond=0):
                raise InvalidToken("Session révoquée.")
        if user.role == UserRole.DRIVER and user.active_device_id:
            if validated_token.get("device") != user.active_device_id:
                raise InvalidToken("Un autre appareil est connecté à ce compte chauffeur.")
        return user
