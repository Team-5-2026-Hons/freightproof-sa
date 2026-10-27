"""Security-relevant response headers, applied to every response. Centralised
here rather than each frontend's hosting config since the API is what both
frontends (and any future client) talk to.
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

_CSP_EXEMPT_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})

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

        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if request.url.path not in _CSP_EXEMPT_PATHS:
            response.headers["Content-Security-Policy"] = _JSON_API_CSP

        return response
