"""Resolves the caller's real IP, shared by core/rate_limit.py and endpoints so they
agree on the deployment's proxy topology instead of guessing separately.
"""

from typing import Optional

from fastapi import Request

from app.core.config import settings

FORWARDED_FOR_HEADER = "x-forwarded-for"


def resolve_client_ip(request: Request) -> Optional[str]:
    """Return the caller's IP, or None when it cannot be determined.

    The header is only honoured when RATE_LIMIT_TRUST_PROXY_HEADERS is set — it's
    forgeable otherwise. Setting name is legacy but kept to avoid a silent .env reset.

    Which header is read is deployment topology, hence configuration (CLIENT_IP_HEADER):

      * X-Forwarded-For is a LIST, and only its left-most entry is the original caller.
        That entry is trustworthy solely on an edge that overwrites the header, because
        such an edge discards whatever the caller sent. Railway and nginx do this.
      * Fly's proxy APPENDS the peer instead, so on Fly the left-most entry is caller-
        supplied and reading it would hand any caller both a fresh rate-limit bucket and
        a dictated receiver_ip. Fly-Client-IP carries one address that fly-proxy sets
        itself, so it is read whole.

    config_validation refuses to start a production process configured the unsafe way.
    """
    if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
        header = settings.CLIENT_IP_HEADER.strip().lower() or FORWARDED_FOR_HEADER
        value = request.headers.get(header)
        if value:
            # Split only the list-valued header; a dedicated edge header is one address,
            # and splitting it would quietly truncate an IPv6 value.
            client = value.split(",")[0].strip() if header == FORWARDED_FOR_HEADER else value.strip()
            if client:
                return client

    return request.client.host if request.client else None
