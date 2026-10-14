"""Resolves the caller's real IP, shared by core/rate_limit.py and endpoints so they
agree on the deployment's proxy topology instead of guessing separately.
"""

from typing import Optional

from fastapi import Request

from app.core.config import settings

FORWARDED_FOR_HEADER = "x-forwarded-for"


def resolve_client_ip(request: Request) -> Optional[str]:
    """Return the caller's IP, or None when it cannot be determined.

    X-Forwarded-For is only honoured when RATE_LIMIT_TRUST_PROXY_HEADERS is set — it's
    forgeable otherwise. Setting name is legacy but kept to avoid a silent .env reset.
    """
    if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
        forwarded = request.headers.get(FORWARDED_FOR_HEADER)
        if forwarded:
            client = forwarded.split(",")[0].strip()
            if client:
                return client

    return request.client.host if request.client else None
