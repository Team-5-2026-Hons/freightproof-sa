"""Unit tests for proxy-aware client IP resolution (app/core/client_ip.py).

Two callers depend on this and they fail differently when it is wrong: the rate limiter
buckets the whole internet as one caller, and the handover records the proxy's address as
the receiver's — a silently false evidence field. The tests below cover the header being
trusted, not trusted, and malformed, because all three occur in a real deployment.
"""

from types import SimpleNamespace
from typing import cast

from fastapi import Request

from app.core import client_ip as client_ip_module
from app.core.client_ip import resolve_client_ip


def _request(*, ip: str | None = "203.0.113.10", headers: dict | None = None) -> Request:
    """Enough of a Starlette Request — resolve_client_ip reads only headers and client.

    Mirrors the helper in test_rate_limit.py, including the cast, for the same reason:
    building a real Request means hand-rolling a full ASGI scope for two attribute reads.
    """
    return cast(
        Request,
        SimpleNamespace(
            headers=headers or {},
            client=SimpleNamespace(host=ip) if ip is not None else None,
        ),
    )


# ── Without a trusted proxy ──────────────────────────────────────────────────


def test_the_forwarded_header_is_ignored_when_no_proxy_is_trusted(monkeypatch) -> None:
    # The whole point: an untrusted header is forgeable, so it must not win.
    monkeypatch.setattr(
        client_ip_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False
    )

    resolved = resolve_client_ip(
        _request(ip="203.0.113.10", headers={"x-forwarded-for": "1.1.1.1"})
    )

    assert resolved == "203.0.113.10"


# ── Behind a trusted proxy ───────────────────────────────────────────────────


def test_the_left_most_forwarded_entry_wins_behind_a_trusted_proxy(monkeypatch) -> None:
    monkeypatch.setattr(client_ip_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", True)

    resolved = resolve_client_ip(
        _request(ip="10.0.0.1", headers={"x-forwarded-for": "1.1.1.1, 10.0.0.1"})
    )

    assert resolved == "1.1.1.1"


def test_the_socket_peer_is_used_when_the_proxy_sent_no_header(monkeypatch) -> None:
    monkeypatch.setattr(client_ip_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", True)

    resolved = resolve_client_ip(_request(ip="10.0.0.1"))

    assert resolved == "10.0.0.1"


def test_an_empty_forwarded_header_falls_through_to_the_socket_peer(monkeypatch) -> None:
    # An empty or comma-only header must not resolve to "", which would read downstream
    # as a real identity — one shared rate-limit bucket, and an empty evidence field.
    monkeypatch.setattr(client_ip_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", True)

    resolved = resolve_client_ip(
        _request(ip="10.0.0.1", headers={"x-forwarded-for": "   ,  "})
    )

    assert resolved == "10.0.0.1"


# ── No client at all ─────────────────────────────────────────────────────────


def test_a_request_with_no_client_resolves_to_none(monkeypatch) -> None:
    # None, not "unknown": the rate limiter needs a bucket key and coerces it itself,
    # but the handover's evidence field must record absence as absence.
    monkeypatch.setattr(
        client_ip_module.settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False
    )

    resolved = resolve_client_ip(_request(ip=None))

    assert resolved is None
