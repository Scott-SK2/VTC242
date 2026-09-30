from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.common.models import TimeStampedModel


class UserRole(models.TextChoices):
    PASSENGER = "passenger", "Passager"
    DRIVER = "driver", "Chauffeur"
    ADMIN = "admin", "Administrateur"
    FINANCE = "finance", "Finance"
    SUPPORT = "support", "Support"


STAFF_ROLES = (UserRole.ADMIN, UserRole.FINANCE, UserRole.SUPPORT)
TOTP_ROLES = (UserRole.ADMIN, UserRole.FINANCE)


class UserManager(BaseUserManager["User"]):
    def create_user(self, phone_number: str, role: str = UserRole.PASSENGER, **extra):
        if not phone_number:
            raise ValueError("Le numéro de téléphone est obligatoire.")
        user = self.model(phone_number=phone_number, role=role, **extra)
        user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, phone_number: str, password: str | None = None, **extra):
        user = self.model(
            phone_number=phone_number, role=UserRole.ADMIN, is_superuser=True, **extra
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    """Tous les comptes (table users, section 6.2)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=20, unique=True)
    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.PASSENGER)
    photo_url = models.URLField(max_length=500, blank=True, null=True)
    language = models.CharField(max_length=5, default="fr")
    is_active = models.BooleanField(default=True)
    blocked_reason = models.TextField(blank=True, null=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # Un chauffeur a un seul appareil actif (F-05) : identifiant de session courante.
    active_device_id = models.CharField(max_length=64, blank=True, null=True)
    # Révocation globale : tout refresh émis avant cette date est invalide (F-02).
    tokens_valid_from = models.DateTimeField(default=timezone.now)
    totp_secret = models.CharField(max_length=64, blank=True, null=True)
    totp_enabled = models.BooleanField(default=False)
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, default=5)
    rating_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "phone_number"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        db_table = "users"

    def __str__(self) -> str:
        return f"{self.first_name} ({self.role})"

    @property
    def is_staff(self) -> bool:  # accès à l'admin Django
        return self.role in STAFF_ROLES or self.is_superuser

    @property
    def is_staff_role(self) -> bool:
        return self.role in STAFF_ROLES

    @property
    def last_initial(self) -> str:
        return (self.last_name[:1] or "").upper()

    @property
    def public_name(self) -> str:
        return f"{self.first_name} {self.last_initial}.".strip()


class OtpCode(TimeStampedModel):
    phone_number = models.CharField(max_length=20, db_index=True)
    code_hash = models.CharField(max_length=256)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "otp_codes"

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at


class PushSubscription(TimeStampedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "push_subscriptions"
