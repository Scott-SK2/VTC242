from rest_framework.permissions import BasePermission

from apps.accounts.models import UserRole


class IsPassenger(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.PASSENGER
        )


class IsDriver(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated and request.user.role == UserRole.DRIVER
        )


class IsPassengerOrDriver(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (UserRole.PASSENGER, UserRole.DRIVER)
        )


class IsStaff(BasePermission):
    """admin, finance ou support (section 4.4)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff_role)


class HasRole(BasePermission):
    """Permission paramétrable : `required_roles` sur la vue."""

    def has_permission(self, request, view):
        roles = getattr(view, "required_roles", None) or ()
        return bool(
            request.user
            and request.user.is_authenticated
            and (not roles or request.user.role in roles)
        )
