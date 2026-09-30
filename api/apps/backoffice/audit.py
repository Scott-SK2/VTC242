from __future__ import annotations

import json

from .models import AuditLog


def audit(request, action: str, target, diff: dict | None = None) -> AuditLog:
    target_type = type(target).__name__ if not isinstance(target, str) else target
    target_id = str(getattr(target, "pk", "")) if not isinstance(target, str) else ""
    ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get(
        "REMOTE_ADDR"
    )
    return AuditLog.objects.create(
        actor=request.user,
        action=action,
        target_type=target_type,
        target_id=target_id,
        diff=json.loads(json.dumps(diff or {}, default=str)),
        ip_address=ip or None,
    )
