"""Contrôle des adresses de fichiers envoyées par les clients (photo, pièce justificative)."""

from __future__ import annotations

from urllib.parse import urlparse

from django.conf import settings

from .exceptions import ApiError


def _allowed_hosts(request) -> set[str]:
    hosts = {request.get_host().split(":")[0].lower()}
    api_host = urlparse(settings.API_BASE_URL).hostname
    if api_host:
        hosts.add(api_host.lower())
    try:
        from django.core.files.storage import default_storage

        storage_host = urlparse(default_storage.url("uploads/x")).hostname
        if storage_host:
            hosts.add(storage_host.lower())
    except Exception:  # noqa: BLE001 - stockage sans URL publique
        pass
    return hosts


def check_own_upload(url: str | None, request) -> None:
    """Une photo ou une pièce doit être un fichier téléversé par l'utilisateur lui-même sur
    notre stockage : pas d'image hébergée ailleurs (traçage des passagers) ni de lien vers
    une page piégée ouverte par le support."""
    if not url:
        return
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme not in ("http", "https")
        or host not in _allowed_hosts(request)
        or f"/uploads/{request.user.id}/" not in parsed.path
        or ".." in parsed.path
    ):
        raise ApiError(
            "Fichier invalide : téléversez-le depuis l'application.", code="invalid_upload"
        )
