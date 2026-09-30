"""Idempotency-Key : même clé → même réponse pendant 24 h (section 7)."""

from __future__ import annotations

import functools
import hashlib
import json
from typing import Any

from django.conf import settings
from django.core.cache import cache
from rest_framework.response import Response


def _cache_key(user_id: Any, key: str, path: str) -> str:
    digest = hashlib.sha256(f"{user_id}:{key}:{path}".encode()).hexdigest()
    return f"idem:{digest}"


def idempotent(view_func):
    @functools.wraps(view_func)
    def wrapper(self, request, *args, **kwargs):
        key = request.headers.get("Idempotency-Key")
        if not key:
            return view_func(self, request, *args, **kwargs)
        cache_key = _cache_key(getattr(request.user, "id", "anon"), key, request.path)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(json.loads(cached["body"]), status=cached["status"])
        response = view_func(self, request, *args, **kwargs)
        if 200 <= response.status_code < 300:
            response.accepted_renderer = getattr(response, "accepted_renderer", None)
            body = json.dumps(response.data, default=str)
            cache.set(
                cache_key,
                {"status": response.status_code, "body": body},
                timeout=settings.IDEMPOTENCY_TTL_S,
            )
        return response

    return wrapper
