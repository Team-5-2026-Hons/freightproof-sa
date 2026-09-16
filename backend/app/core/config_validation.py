"""Production preconditions, checked once at import time so a bad deploy never serves.

Every rule here exists because the failure it catches is SILENT. That is the entire
selection criterion — a misconfiguration that throws, or that shows up in a log as an
obvious error, does not need a rule, because it announces itself. These do not:

  * HANDOVER_RECEIVER_BASE_URL left at localhost puts `http://localhost:3002` inside the
    QR the driver's screen displays AND inside the callback handed to Didit. Nothing
    errors. The receiver's phone simply resolves localhost to itself, and the page reports
    "This link is no longer valid" — which is also what a genuinely dead token says, by
    deliberate anti-oracle design. The one failure indistinguishable from normal operation.

  * IDVS_USE_MOCK=false with no IDVS_WEBHOOK_SECRET makes verify_webhook_signature fail
    CLOSED (receiver_verification_service.py). Every vendor delivery is rejected 401 and
    logged as an invalid signature — indistinguishable in the logs from an attacker, and
    invisible unless someone is reading them.

  * RATE_LIMIT_TRUST_PROXY_HEADERS left at its default behind a proxy collapses every
    unauthenticated caller into one rate-limit bucket and records the proxy's address as
    the receiver's IP on every handover (core/client_ip.py). Both fail quietly: one as
    mysterious 429s under load, the other as evidence that is merely wrong.

Rules deliberately NOT here:

  * DEV_PANEL_ENABLED. The deployed demo genuinely runs as ENVIRONMENT=production (to keep
    /docs unpublished) and still needs the panel — see config.DEV_PANEL_ENABLED. Failing on
    it would break the documented demo setup.
  * A blanket ban on "localhost" in ALLOWED_ORIGINS. Two of the driver app's real,
    permanent production origins are capacitor://localhost and https://localhost.

Every failure is collected and reported together. A deploy that is wrong in three ways
should learn all three at once, not discover them over three restarts.

Layering: core -> config only.
"""

import logging
from typing import List
from urllib.parse import urlparse

from app.core.config import Settings

logger = logging.getLogger(__name__)

_PRODUCTION = "production"

# Hosts that mean "this machine", which is never the right answer for a URL handed to a
# stranger's phone or to a third-party vendor's redirect.
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1")


class ProductionConfigError(RuntimeError):
    """Production configuration is unsafe or incomplete. Raised at import, not per-request."""


def _is_loopback(url: str) -> bool:
    """True when the URL's HOST is a loopback address.

    Parsed rather than substring-matched: "//localhost" appears inside
    "https://localhost.example.co.za", which is an ordinary public hostname that would
    otherwise be refused as loopback and block a legitimate deploy.
    """
    host = (urlparse(url.lower()).hostname or "").strip("[]")
    return host in _LOOPBACK_HOSTS


def collect_production_config_errors(settings: Settings) -> List[str]:
    """Every production precondition this configuration violates.

    Returns an empty list outside production, and for a correct production config. Split
    from the raising wrapper so tests can assert on the rules without building an app.
    """
    if settings.ENVIRONMENT != _PRODUCTION:
        return []

    errors: List[str] = []

    # --- CORS -----------------------------------------------------------------------
    # Pre-existing rule, moved here from main.py so every production precondition is in
    # one place. '*' with allow_credentials=True is the combination browsers refuse — but
    # only once a real user is already exposed to it.
    if "*" in settings.ALLOWED_ORIGINS:
        errors.append(
            "ALLOWED_ORIGINS may not contain '*' in production. List the dispatcher's "
            "real origin explicitly (the driver app's native origins are added "
            "automatically — see Settings.cors_allowed_origins)."
        )

    # --- Receiver app ---------------------------------------------------------------
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

    # --- Didit, when live -----------------------------------------------------------
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

    # --- Proxy topology -------------------------------------------------------------
    # Required to be an EXPLICIT decision rather than required to be true: a production
    # deployment genuinely not behind a proxy must be able to say so. model_fields_set
    # distinguishes "deliberately false" from "nobody thought about it", which a bare
    # boolean cannot.
    if "RATE_LIMIT_TRUST_PROXY_HEADERS" not in settings.model_fields_set:
        errors.append(
            "RATE_LIMIT_TRUST_PROXY_HEADERS is not set explicitly. In production it must "
            "be a deliberate statement about the deployment's topology: true behind a "
            "proxy that overwrites X-Forwarded-For (Railway, nginx, a load balancer), "
            "false only when this process is directly internet-facing. Left unset, every "
            "unauthenticated caller shares one rate-limit bucket and the receiver_ip "
            "recorded on each handover is the proxy's."
        )

    if not settings.RATE_LIMIT_ENABLED:
        errors.append(
            "RATE_LIMIT_ENABLED is false in production. It is the only volume control on "
            "endpoints that spend Hedera and Parcel Perfect quota."
        )

    return errors


def enforce_production_config(settings: Settings) -> None:
    """Raise if this configuration must not serve production traffic.

    Called at import time from main.py, so the process refuses to start and the
    orchestrator's health check fails immediately — rather than the deployment coming up
    green and the breakage surfacing later as a handover nobody can explain.
    """
    errors = collect_production_config_errors(settings)
    if not errors:
        return

    numbered = "\n".join(f"  {i}. {error}" for i, error in enumerate(errors, start=1))
    message = (
        f"Refusing to start: {len(errors)} production configuration "
        f"{'error' if len(errors) == 1 else 'errors'}.\n{numbered}"
    )
    # Logged as well as raised: depending on how the platform surfaces a failed start, a
    # traceback can be truncated where a log line survives.
    logger.critical(message)
    raise ProductionConfigError(message)
