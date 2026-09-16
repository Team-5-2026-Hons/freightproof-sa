"""Resolving the real IP of a caller, given what the deployment sits behind.

Extracted because two callers need the same answer and only one of them used to get it
right. `rate_limit.py` has always consulted X-Forwarded-For behind a trusted proxy;
`api/v1/endpoints/handover.py` read `request.client.host` directly, which behind Railway's
edge records Railway's own internal address. For the rate limiter that meant every
unauthenticated caller sharing one bucket; for the handover it meant an EVIDENCE field —
the IP the receiver confirmed a delivery from — being silently wrong on every single
delivery, with no error and nothing in the logs to suggest it.

The question both are asking is identical and is a property of the deployment topology,
not of the feature: is there a proxy in front of this process that overwrites
X-Forwarded-For? So it is answered once, here.

Layering: core -> config only. Imported by core/rate_limit.py and by endpoints.
"""

from typing import Optional

from fastapi import Request

from app.core.config import settings

# Lower-case: Starlette's header mapping is case-insensitive, and this spelling matches
# the wire format most proxies emit.
FORWARDED_FOR_HEADER = "x-forwarded-for"


def resolve_client_ip(request: Request) -> Optional[str]:
    """The caller's own IP, or None when it cannot be determined.

    X-Forwarded-For is honoured ONLY when the deployment declares it sits behind a proxy
    it trusts (RATE_LIMIT_TRUST_PROXY_HEADERS). Reading that header unconditionally would
    make it worthless for both callers: a rate-limit budget any caller could reset by
    sending a fresh value, and an evidence field any caller could dictate outright. When
    the setting is off, the socket peer address is used, which cannot be forged over TCP.

    The setting is still spelled RATE_LIMIT_* although it now governs more than the rate
    limiter. Renaming it is deliberately NOT done here: Settings uses extra="ignore", so a
    rename would make every existing .env silently fall back to the default of False —
    turning a correctly-configured deployment into a quietly broken one, which is the
    exact failure mode this module exists to remove. A rename needs the team's agreement
    and a coordinated .env update, not a drive-by.
    """
    if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
        forwarded = request.headers.get(FORWARDED_FOR_HEADER)
        if forwarded:
            # Left-most entry is the original client; the rest are proxy hops. A header
            # present but empty (or just commas) falls through to the socket peer rather
            # than returning an empty string that would read as a real identity.
            client = forwarded.split(",")[0].strip()
            if client:
                return client

    return request.client.host if request.client else None
