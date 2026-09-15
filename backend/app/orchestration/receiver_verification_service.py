"""Receiver identity verification — quota metering and the identity cross-check.

Stage 1 scope: the two pieces of logic that are pure enough to test without HTTP. The
session lifecycle, tier resolution and exception raising arrive in Stage 2.

Layering: orchestration -> integrations, db. No HTTP concerns belong here.
"""

import logging
import unicodedata
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.receiver_verification import IdvsQuotaLedger

logger = logging.getLogger(__name__)

PROVIDER_DIDIT = "didit"


def _strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _normalise_name(value: str) -> str:
    """Casefold, strip accents, collapse whitespace, drop punctuation.

    Punctuation goes because a document reads "NKOSI" where a receiver types "Nkosi," —
    a comma is not a mismatch, and treating it as one would manufacture fraud signals out
    of typing habits.
    """
    cleaned = "".join(
        char if char.isalnum() or char.isspace() else " "
        for char in _strip_diacritics(value)
    )
    return " ".join(cleaned.casefold().split())


def _normalise_id_number(value: str) -> str:
    """Keep alphanumerics only.

    Passports and company registration numbers legitimately carry letters, and documents
    print separators an ID book does not. Comparing the raw strings would fail on
    formatting alone.
    """
    return "".join(char for char in value if char.isalnum()).casefold()


def identity_matches(
    *,
    typed_name: str,
    typed_id_number: str,
    extracted_surname: Optional[str],
    extracted_id_number: Optional[str],
) -> Optional[bool]:
    """Whether the vendor's extracted identity agrees with what the receiver typed.

    Returns None — not False — when there is nothing to compare. The distinction is the
    whole point: "we could not check" and "we checked and it disagreed" are different
    facts, and the exception types they feed are deliberately kept apart for exactly the
    reason SEAL_UNVERIFIED and SEAL_MISMATCH are.

    Only the SURNAME is compared, and only for presence among the typed name's tokens.
    Given-name ordering, initials and middle names vary far too much between a printed
    document and a one-handed entry on a warehouse floor to carry a fraud signal; a
    surname that is absent entirely does.

    This never blocks anything. A False result is recorded as evidence and surfaced to a
    dispatcher — the delivery still confirms.
    """
    if extracted_surname is None and extracted_id_number is None:
        return None

    if extracted_id_number is not None:
        if _normalise_id_number(typed_id_number) != _normalise_id_number(extracted_id_number):
            return False

    if extracted_surname is not None:
        surname = _normalise_name(extracted_surname)
        if not surname or surname not in _normalise_name(typed_name).split():
            return False

    return True


async def consume_quota_slot(db: AsyncSession, *, provider: str = PROVIDER_DIDIT) -> bool:
    """Claim one free-tier session for this month. True if one was available.

    The conditional UPDATE is the gate, not a read-then-write in Python: two handovers
    starting at the same instant race the database, exactly as redeem_capability_token
    makes two simultaneous scans do. A read-then-write here would let both pass the
    ceiling and silently bill.

    The period key is UTC because the vendor's quota resets at 00:00 UTC — 02:00 SAST.
    Keying on local time would roll the counter two hours late and bill for the gap.
    """
    period = datetime.now(UTC).strftime("%Y-%m")

    # Ensure the row exists without disturbing a concurrent creator. DO NOTHING rather
    # than DO UPDATE: the increment below is the only thing allowed to move the counter.
    await db.execute(
        pg_insert(IdvsQuotaLedger)
        .values(period=period, provider=provider, sessions_used=0)
        .on_conflict_do_nothing(index_elements=["period", "provider"])
    )

    consumed = (
        await db.execute(
            update(IdvsQuotaLedger)
            .where(
                IdvsQuotaLedger.period == period,
                IdvsQuotaLedger.provider == provider,
                IdvsQuotaLedger.sessions_used < settings.IDVS_MONTHLY_SESSION_LIMIT,
            )
            .values(sessions_used=IdvsQuotaLedger.sessions_used + 1)
            .returning(IdvsQuotaLedger.sessions_used)
        )
    ).scalar_one_or_none()
    await db.flush()

    if consumed is None:
        logger.warning(
            "IDVS monthly quota exhausted for provider=%s period=%s — degrading tier",
            provider, period,
        )
        return False
    return True
