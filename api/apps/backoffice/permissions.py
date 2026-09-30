"""Rôles admin / finance / support + 2FA TOTP obligatoire pour admin et finance (section 9)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from apps.accounts.models import TOTP_ROLES, UserRole
from apps.common.exceptions import ApiError

ALL_STAFF = (UserRole.ADMIN, UserRole.FINANCE, UserRole.SUPPORT)


class StaffPermission(BasePermission):
    roles: tuple[str, ...] = ALL_STAFF

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.role in ALL_STAFF):
            return False
        roles = getattr(view, "roles", None) or self.roles
        if user.role not in roles:
            raise ApiError("Rôle insuffisant.", code="forbidden", status_code=403)
        if user.role in TOTP_ROLES and user.totp_enabled:
            token = getattr(request, "auth", None)
            if not token or not token.get("totp"):
                raise ApiError("Validation TOTP requise.", code="totp_required", status_code=403)
        return True


ADMIN_ONLY = (UserRole.ADMIN,)
ADMIN_FINANCE = (UserRole.ADMIN, UserRole.FINANCE)
ADMIN_SUPPORT = (UserRole.ADMIN, UserRole.SUPPORT)
