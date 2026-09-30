from __future__ import annotations

import uuid

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.common.exceptions import ApiError
from apps.common.throttling import OtpRequestThrottle

from . import services
from .authentication import issue_tokens
from .models import User
from .serializers import (
    OtpRequestSerializer,
    OtpVerifySerializer,
    ProfileUpdateSerializer,
    PushSubscriptionSerializer,
    RefreshSerializer,
    UploadRequestSerializer,
    UserSerializer,
)


class OtpRequestView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = (OtpRequestThrottle,)

    def post(self, request):
        ser = OtpRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(services.request_otp(ser.validated_data["phone_number"]), status=202)


class OtpVerifyView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        ser = OtpVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        result = services.verify_otp(
            data["phone_number"], data["code"], data.get("role"), data.get("device_id")
        )
        return Response(
            {
                "access": result["access"],
                "refresh": result["refresh"],
                "created": result["created"],
                "user": UserSerializer(result["user"]).data,
            }
        )


class TokenRefreshView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        ser = RefreshSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            old = RefreshToken(ser.validated_data["refresh"])
        except TokenError:
            raise ApiError("Jeton invalide ou expiré.", code="invalid_token", status_code=401)
        user = User.objects.filter(id=old["user_id"]).first()
        if user is None or not user.is_active or user.deleted_at:
            raise ApiError("Compte inactif.", code="inactive", status_code=401)
        issued = old.get("iat")
        if issued is not None and issued < int(user.tokens_valid_from.timestamp()):
            raise ApiError("Session révoquée.", code="invalid_token", status_code=401)
        device = old.get("device")
        if user.role == "driver" and user.active_device_id and device != user.active_device_id:
            raise ApiError(
                "Un autre appareil est connecté.", code="device_conflict", status_code=401
            )
        try:
            old.blacklist()
        except TokenError:
            raise ApiError("Jeton déjà utilisé.", code="invalid_token", status_code=401)
        return Response(issue_tokens(user, device_id=device, totp_ok=bool(old.get("totp"))))


class LogoutView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        ser = RefreshSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            RefreshToken(ser.validated_data["refresh"]).blacklist()
        except TokenError:
            pass
        return Response(status=204)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        ser = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        services.anonymize_user(request.user)
        return Response(status=204)


class PushSubscriptionView(APIView):
    def post(self, request):
        ser = PushSubscriptionSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response({"ok": True}, status=201)


class UploadRequestView(APIView):
    """URL pré-signée (R2 en production) ; en local, PUT direct sur l'API (section 9)."""

    def post(self, request):
        ser = UploadRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if data["content_type"] not in settings.UPLOAD_ALLOWED_TYPES:
            raise ApiError(
                "Type de fichier non autorisé (jpg, png, pdf).",
                code="unsupported_type",
                status_code=415,
            )
        ext = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}[
            data["content_type"]
        ]
        key = f"uploads/{request.user.id}/{data['kind']}/{uuid.uuid4().hex}.{ext}"
        storage = default_storage
        if hasattr(storage, "bucket"):  # S3 / R2
            client = storage.connection.meta.client
            upload_url = client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": storage.bucket_name,
                    "Key": key,
                    "ContentType": data["content_type"],
                },
                ExpiresIn=900,
            )
            file_url = storage.url(key)
            headers = {"Content-Type": data["content_type"]}
        else:
            upload_url = f"{settings.API_BASE_URL}/api/v1/me/uploads/{key}"
            file_url = f"{settings.API_BASE_URL}{settings.MEDIA_URL}{key}"
            headers = {"Content-Type": data["content_type"]}
        return Response(
            {"upload_url": upload_url, "file_url": file_url, "method": "PUT", "headers": headers}
        )


class LocalUploadView(APIView):
    """Réception directe des fichiers en local (remplace R2)."""

    parser_classes = ()

    def put(self, request, key: str):
        if not key.startswith(f"uploads/{request.user.id}/"):
            raise ApiError("Clé invalide.", code="forbidden", status_code=403)
        body = request.body
        if len(body) > settings.UPLOAD_MAX_BYTES:
            raise ApiError(
                "Fichier trop volumineux (10 Mo max).", code="too_large", status_code=413
            )
        from django.core.files.base import ContentFile

        default_storage.save(key, ContentFile(body))
        return HttpResponse(status=204)


local_upload_view = csrf_exempt(LocalUploadView.as_view())
