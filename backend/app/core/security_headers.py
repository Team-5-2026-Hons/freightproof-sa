"""Security-relevant response headers, applied to every response.

Not one of these headers changes what the API does — they change what a browser is
willing to do with the response afterwards: refuse to guess a content type, refuse to
frame the page, refuse to leak the full referrer, and refuse a downgrade to plain HTTP
on repeat visits. Centralised here rather than left to each frontend's hosting config
because the API itself is what both frontends (and any future client) talk to.
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# The interactive docs serve Swagger UI's own inline scripts and styles — a strict
# default-src would break rendering. They are only reachable outside production anyway
# (see main.py's docs_url guard), so exempting them here trades nothing in production.
_CSP_EXEMPT_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})

# This API returns JSON, never HTML it expects a browser to render — so the tightest
# policy that does not break anything is "load nothing", not a curated allowlist.
_JSON_API_CSP = "default-src 'none'; frame-ancestors 'none'"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds standard hardening headers to every response, including error responses.

    Registered last (outermost) in main.py so it wraps CORS and rate limiting too —
    a 429 or a CORS-rejected request still gets these headers on the way out.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)

        # Two years, applies to subdomains: long enough that a browser which has ever
        # seen this host will not downgrade to plain HTTP again within the policy's
        # lifetime. Harmless to send over a plain-HTTP dev server — browsers only
        # honour it on a response actually received over HTTPS.
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        # Stops a browser from sniffing a response into executing as a different
        # content type than the one declared (e.g. an uploaded artifact served back
        # as text/html).
        response.headers["X-Content-Type-Options"] = "nosniff"
        # This API is never meant to be framed by another site.
        response.headers["X-Frame-Options"] = "DENY"
        # Full referrer leaks the path (trip IDs, waybill numbers) to whatever the
        # browser navigates to next; same-origin requests still get the full value.
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if request.url.path not in _CSP_EXEMPT_PATHS:
            response.headers["Content-Security-Policy"] = _JSON_API_CSP

        return response
