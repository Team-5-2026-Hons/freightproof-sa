"""Security-relevant response headers, applied to every response. Centralised
here rather than each frontend's hosting config since the API is what both
frontends (and any future client) talk to.
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Docs pages need inline scripts/styles for Swagger UI; only reachable
# outside production anyway (see main.py's docs_url guard).
_CSP_EXEMPT_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})

# JSON API, never HTML a browser renders — "load nothing" is safe here.
_JSON_API_CSP = "default-src 'none'; frame-ancestors 'none'"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds standard hardening headers to every response, including errors.

    Registered last (outermost) in main.py so a 429 or CORS-rejected
    response still gets these headers too.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)

        # 2yr HSTS incl. subdomains; harmless over plain-HTTP dev (browsers
        # only honour it on responses actually received over HTTPS).
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        # Stop content-type sniffing (e.g. an artifact served back as text/html).
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        # Full referrer would leak paths (trip IDs, waybill numbers) cross-origin.
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if request.url.path not in _CSP_EXEMPT_PATHS:
            response.headers["Content-Security-Policy"] = _JSON_API_CSP

        return response
