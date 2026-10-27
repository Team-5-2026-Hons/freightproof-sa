"""Production preconditions, checked once at import time so a bad deploy never serves.

Selection criterion: every rule here catches a SILENT failure — one that
throws or logs an obvious error doesn't need a rule. E.g. a localhost
HANDOVER_RECEIVER_BASE_URL resolves fine on the receiver's own phone and
just reports "link no longer valid" (indistinguishable from a dead token);
a missing IDVS_WEBHOOK_SECRET fails webhook verification closed, logged
only as an invalid signature; a misconfigured RATE_LIMIT_TRUST_PROXY_HEADERS
silently misattributes IPs and rate-limit buckets.

Deliberately NOT enforced: DEV_PANEL_ENABLED (the deployed demo genuinely
runs as ENVIRONMENT=production and needs the panel), and a blanket ban on
"localhost" in ALLOWED_ORIGINS (capacitor://localhost/https://localhost are
real driver-app production origins).

Every failure is collected and reported together, not one restart at a time.

Layering: core -> config only.
"""

import logging
from typing import List
from urllib.parse import urlparse

from app.core.config import Settings

logger = logging.getLogger(__name__)

_PRODUCTION = "production"

_FORWARDED_FOR_HEADER = "x-forwarded-for"

_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1")


class ProductionConfigError(RuntimeError):
    """Production configuration is unsafe or incomplete. Raised at import, not per-request."""


def _is_loopback(url: str) -> bool:
    """True when the URL's HOST is a loopback address.

    Parsed rather than substring-matched: "//localhost" appears inside
    "https://localhost.example.co.za", an ordinary public hostname.
    """
    host = (urlparse(url.lower()).hostname or "").strip("[]")
    return host in _LOOPBACK_HOSTS


def _proxy_topology_errors(settings: Settings) -> List[str]:
    """Rules about which address this process believes, and therefore records.

    Extracted as a pair because they are one decision with two failure modes, and both
    are silent: whatever these settings resolve to becomes the rate-limit bucket key AND
    the receiver_ip written to a handover confirmation as evidence.
    """
    errors: List[str] = []

    if "RATE_LIMIT_TRUST_PROXY_HEADERS" not in settings.model_fields_set:
        errors.append(
            "RATE_LIMIT_TRUST_PROXY_HEADERS is not set explicitly. In production it must "
            "be a deliberate statement about the deployment's topology: true behind an "
            "edge that guarantees CLIENT_IP_HEADER (Fly's fly-client-ip, or an "
            "X-Forwarded-For that nginx or a load balancer overwrites), false only when "
            "this process is directly internet-facing. Left unset, every "
            "unauthenticated caller shares one rate-limit bucket and the receiver_ip "
            "recorded on each handover is the proxy's."
        )

    if (
        settings.FLY_APP_NAME.strip()
        and settings.RATE_LIMIT_TRUST_PROXY_HEADERS
        and settings.CLIENT_IP_HEADER.strip().lower() == _FORWARDED_FOR_HEADER
    ):
        errors.append(
            "CLIENT_IP_HEADER is X-Forwarded-For while running on Fly (FLY_APP_NAME is "
            "set) and RATE_LIMIT_TRUST_PROXY_HEADERS is true. Fly's proxy appends to that "
            "header instead of overwriting it, so its left-most entry is caller-supplied: "
            "rate limits become bypassable per forged value and the receiver_ip recorded "
            "on every handover confirmation is dictated by the caller. Set "
            "CLIENT_IP_HEADER=fly-client-ip, which fly-proxy sets itself."
        )

    return errors


def collect_production_config_errors(settings: Settings) -> List[str]:
    """Every production precondition this configuration violates.

    Empty outside production and for a correct production config. Split
    from the raising wrapper so tests can assert on the rules directly.
    """
    if settings.ENVIRONMENT != _PRODUCTION:
        return []

    errors: List[str] = []

    if "*" in settings.ALLOWED_ORIGINS:
        errors.append(
            "ALLOWED_ORIGINS may not contain '*' in production. List the dispatcher's "
            "real origin explicitly (the driver app's native origins are added "
            "automatically — see Settings.cors_allowed_origins)."
        )

    receiver_url = settings.HANDOVER_RECEIVER_BASE_URL.strip()
    if not receiver_url:
        errors.append(
            "HANDOVER_RECEIVER_BASE_URL is empty. It is the origin encoded into every "
            "handover QR and handed to Didit as the return callback."
        )
    elif _is_loopback(receiver_url):
        errors.append(
            f"HANDOVER_RECEIVER_BASE_URL is {receiver_url!r}, a loopback address. The QR "
            "is scanned by a receiver's OWN phone, where localhost is that phone — every "
            "handover would dead-end on a page that cannot be told from an expired token."
        )
    elif not receiver_url.lower().startswith("https://"):
        errors.append(
            f"HANDOVER_RECEIVER_BASE_URL is {receiver_url!r}, which is not https. The "
            "handover binding cookie is set Secure outside development, so a plain-HTTP "
            "receiver app can never receive it and every confirmation fails its binding "
            "check with a generic 404."
        )

    if not settings.IDVS_USE_MOCK:
        missing = [
            name
            for name, value in (
                ("IDVS_API_URL", settings.IDVS_API_URL),
                ("IDVS_API_KEY", settings.IDVS_API_KEY),
                ("IDVS_WORKFLOW_ID", settings.IDVS_WORKFLOW_ID),
            )
            if not value.strip()
        ]
        if missing:
            errors.append(
                f"IDVS_USE_MOCK is false but {', '.join(missing)} unset. Live verification "
                "cannot start a session, so every receiver silently degrades to a lower "
                "evidence tier."
            )

        if not settings.IDVS_WEBHOOK_SECRET.strip():
            errors.append(
                "IDVS_USE_MOCK is false but IDVS_WEBHOOK_SECRET is unset. Webhook "
                "signature verification fails CLOSED, so every vendor decision delivery "
                "is rejected 401 and logged as an invalid signature — the backstop for "
                "decisions the receiver's own return never delivered is silently gone."
            )

    errors.extend(_proxy_topology_errors(settings))

    if not settings.RATE_LIMIT_ENABLED:
        errors.append(
            "RATE_LIMIT_ENABLED is false in production. It is the only volume control on "
            "endpoints that spend Hedera and Parcel Perfect quota."
        )

    return errors


def enforce_production_config(settings: Settings) -> None:
    """Raise if this configuration must not serve production traffic.

    Called at import time from main.py, so the process refuses to start
    rather than coming up green and breaking later.
    """
    errors = collect_production_config_errors(settings)
    if not errors:
        return

    numbered = "\n".join(f"  {i}. {error}" for i, error in enumerate(errors, start=1))
    message = (
        f"Refusing to start: {len(errors)} production configuration "
        f"{'error' if len(errors) == 1 else 'errors'}.\n{numbered}"
    )
    logger.critical(message)
    raise ProductionConfigError(message)
