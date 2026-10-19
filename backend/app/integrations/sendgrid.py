"""SendGrid transactional email — used only for audit-pack one-time codes (FP-291).

Contract (SendGrid v3 Mail Send, POST /v3/mail/send): a JSON body of personalizations,
from, subject and content; success is 202 Accepted with an empty body. Anything else is a
failure. https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send

Layering: integrations -> config only. Callers get EmailUnavailableError, never an httpx
type or a vendor body.

POPIA: the recipient's address and the message body leave the system (SendGrid processes
them outside South Africa). Callers must keep the body free of trip data: a code and a
pack label, nothing a reader could learn the cargo, route, driver or incident from.
"""

import logging

import httpx

from app.core.config import settings
from app.core.exceptions import EmailUnavailableError

logger = logging.getLogger(__name__)

_MAIL_SEND_PATH = "/v3/mail/send"


async def send_plain_text_email(*, to_address: str, subject: str, body: str) -> None:
    """Hand one plain-text email to SendGrid. Returns once SendGrid accepts it (202) —
    acceptance, not delivery: SendGrid may still bounce it later.

    Raises EmailUnavailableError on any failure, including no key configured, so a dev
    machine without one fails visibly instead of pretending the email was sent.
    """
    if not settings.SENDGRID_API_KEY or not settings.SENDGRID_FROM_EMAIL:
        raise EmailUnavailableError("SENDGRID_API_KEY or SENDGRID_FROM_EMAIL is not set.")

    payload = {
        "personalizations": [{"to": [{"email": to_address}]}],
        "from": {"email": settings.SENDGRID_FROM_EMAIL, "name": "FreightProof"},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}],
        # Click tracking rewrites links through SendGrid's domain; nothing here should be tracked.
        "tracking_settings": {"click_tracking": {"enable": False}, "open_tracking": {"enable": False}},
    }
    url = settings.SENDGRID_API_URL.rstrip("/") + _MAIL_SEND_PATH

    try:
        async with httpx.AsyncClient(timeout=settings.SENDGRID_TIMEOUT_SECONDS) as http:
            response = await http.post(
                url, json=payload, headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
            )
    except httpx.HTTPError as exc:
        raise EmailUnavailableError(f"SendGrid unreachable: {exc!r}") from exc

    if response.status_code != httpx.codes.ACCEPTED:
        # SendGrid's error body names the problem (unverified sender, bad key) without
        # echoing the recipient, so it is safe and useful in the log.
        logger.error("SendGrid refused an email: HTTP %s %s", response.status_code, response.text[:300])
        raise EmailUnavailableError(f"SendGrid returned HTTP {response.status_code}")
