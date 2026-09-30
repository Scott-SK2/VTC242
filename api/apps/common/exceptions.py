"""Format d'erreur uniforme { code, message, details } (section 7)."""

from __future__ import annotations

from typing import Any

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class ApiError(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "error"
    default_detail = "Requête invalide."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: Any = None,
    ) -> None:
        self.message = message or self.default_detail
        self.code = code or self.default_code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}
        super().__init__(detail=self.message, code=self.code)


class Conflict(ApiError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"
    default_detail = "Conflit d'état."


class PaymentRequired(ApiError):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    default_code = "insufficient_funds"
    default_detail = "Solde insuffisant."


class Unprocessable(ApiError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "unprocessable"
    default_detail = "Requête non traitable."


class Locked(ApiError):
    status_code = status.HTTP_423_LOCKED
    default_code = "locked"
    default_detail = "Ressource verrouillée."


class NotFound(ApiError):
    status_code = status.HTTP_404_NOT_FOUND
    default_code = "not_found"
    default_detail = "Introuvable."


class Forbidden(ApiError):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "forbidden"
    default_detail = "Accès refusé."


_DEFAULT_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    415: "unsupported_media_type",
    429: "rate_limited",
}


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, ApiError):
        return Response(
            {"code": exc.code, "message": exc.message, "details": exc.details},
            status=exc.status_code,
        )
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    data = response.data
    details: Any = {}
    message: str
    if isinstance(exc, exceptions.ValidationError):
        code = "validation_error"
        message = "Données invalides."
        details = data
    elif isinstance(data, dict) and "detail" in data:
        message = str(data["detail"])
        code = getattr(data["detail"], "code", None) or _DEFAULT_CODES.get(
            response.status_code, "error"
        )
    else:
        message = str(data)
        code = _DEFAULT_CODES.get(response.status_code, "error")
    if isinstance(exc, exceptions.Throttled):
        code = "rate_limited"
        details = {"retry_after": exc.wait}
    response.data = {"code": code, "message": message, "details": details}
    return response
