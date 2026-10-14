# Receiver Identity Verification — Stage 2A (Service Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠ GIT RULE.** `CLAUDE.md` forbids Claude running `git commit`, `git push`, `git merge`,
> `git rebase`, `git checkout <branch>`, `git reset`, `git restore`. Every "commit" step
> below **stages only** (`git add` on named files) and hands the developer a message.

> **⚠ PREREQUISITE.** This plan assumes `git merge origin/dev` has landed and Stage 1's
> migration (Stage 1 Task 3) has been generated. Task 1 below **changes the Stage 1 model**,
> so if that migration already exists it must be regenerated, not amended.

**Goal:** The service layer for receiver identity verification — consent, session start,
decision resolution, tier resolution, exception raising, and the terminalisation that
enforces the spec's invariant. No HTTP surface; Stage 2B adds the routes.

**Architecture:** `receiver_verification_service.py` grows from Stage 1's two pure helpers
into the full lifecycle. It owns every judgement (which tier, which exception, when a row
is terminal); `integrations/idvs.py` stays a dumb vendor client and `handover_service.py`
gains exactly one function, the bounded token extension.

**Tech Stack:** Python 3.13, SQLAlchemy 2.0 async, Pydantic v2, pytest + pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-09-14-receiver-identity-verification-design.md`

---

## ⚠ Read this first: why Task 1 exists

The spec was revised mid-design from **confirm-then-verify** (v1) to **verify-then-confirm**
(v2, spec §6). The data model was written against v1 and never re-derived, so it carries a
contradiction:

```python
handover_confirmation_id: Mapped[uuid.UUID] = mapped_column(..., nullable=False)
__table_args__ = (UniqueConstraint("handover_confirmation_id", ...),)
```

Under v2 the verification row is created when the receiver gives consent — **before** they
sign, and therefore before any `handover_confirmations` row exists. A NOT NULL FK to a row
that does not yet exist cannot be satisfied. Stage 2 is unimplementable until this is fixed.

The fix: key the verification on the **capability token**, which exists from the moment the
receiver scans, and let the confirmation link be filled in afterwards.

This costs nothing right now only because Stage 1's migration was blocked and never
generated. Had it been applied, this would be a second migration and a data backfill.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/db/models/receiver_verification.py` *(modify)* | Re-key onto `token_id`; make `handover_confirmation_id` nullable |
| `backend/app/orchestration/receiver_verification_service.py` *(modify)* | Full lifecycle: consent, start, resolve, terminalise, attach |
| `backend/app/orchestration/handover_service.py` *(modify)* | One new function: bounded one-shot token extension |
| `backend/tests/unit/test_receiver_verification_tiers.py` *(create)* | Tier + exception mapping, pure |
| `backend/tests/integration/test_receiver_verification_service.py` *(create)* | Lifecycle against a real DB |
| `backend/tests/integration/test_handover_token_extension.py` *(create)* | Extension is bounded and one-shot |

---

## Task 1: Re-key the verification model onto the capability token

**Files:**
- Modify: `backend/app/db/models/receiver_verification.py`

- [ ] **Step 1: Replace the `__table_args__` and the two FK columns**

Find this block:

```python
    __table_args__ = (
        UniqueConstraint(
            "handover_confirmation_id",
            name="uq_receiver_identity_verifications_confirmation_id",
        ),
    )
```

Replace with:

```python
    __table_args__ = (
        # Keyed on the TOKEN, not the confirmation. The spec's ordering (§6) is
        # verify-then-confirm: this row is created when the receiver consents, which is
        # before they sign and therefore before any handover_confirmations row exists.
        # The token is the only identifier that exists for the whole exchange.
        UniqueConstraint("token_id", name="uq_receiver_identity_verifications_token_id"),
    )
```

- [ ] **Step 2: Replace the `handover_confirmation_id` column with both columns**

Find:

```python
    handover_confirmation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_confirmations.id"), nullable=False
    )
```

Replace with:

```python
    # The grant this verification was performed against. Non-null and unique: a
    # verification with no token did not come from a scan, and one token yields at most
    # one verification.
    token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=False
    )
    # Filled in at confirm time, not at creation. NULL is the ordinary state for a
    # verification whose receiver has not signed yet — and the permanent state for one
    # who verified and then walked away, which is itself part of the record.
    handover_confirmation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_confirmations.id"), nullable=True
    )
```

- [ ] **Step 3: Fix the now-wrong class docstring**

Replace the sentence beginning *"The unique constraint on handover_confirmation_id..."* with:

```
    Keyed on the capability token rather than the confirmation, because the spec's
    ordering is verify-then-confirm: this row exists before the receiver signs. The
    unique constraint on token_id is what makes "one verification per grant" true at
    the database rather than at the application's word.
```

- [ ] **Step 4: Verify the model still builds and the key moved**

```bash
cd backend && .venv/bin/python -c "
from app.db.models import Base
t = Base.metadata.tables['receiver_identity_verifications']
assert not t.c.handover_confirmation_id.nullable is False, 'confirmation FK must be nullable'
assert t.c.token_id.nullable is False, 'token_id must be NOT NULL'
print('cols:', len(t.columns), '| uniques:', sorted(c.name for c in t.constraints if c.name))
"
```

Expected: `cols: 18 | uniques: ['uq_receiver_identity_verifications_token_id']`

- [ ] **Step 5: Regenerate the Stage 1 migration if it already exists**

```bash
cd /Users/timgultig/freightproof-sa && git fetch origin
git log --oneline HEAD..origin/dev -- backend/migrations/versions/
```

Empty ⇒ safe. If a Stage 1 migration file for these tables already exists, **delete it and
regenerate** rather than hand-editing — an autogenerated file and a hand-patched one drift
in ways that only surface on a downgrade. Do **not** run `alembic upgrade`: it targets the
shared Supabase dev database.

- [ ] **Step 6: Stage**

```bash
git add backend/app/db/models/receiver_verification.py
```

Suggested message: `fix(db): key receiver verification on the capability token, not the confirmation`

---

## Task 2: Bounded one-shot token extension

**Files:**
- Modify: `backend/app/orchestration/handover_service.py`
- Test: `backend/tests/integration/test_handover_token_extension.py`

- [ ] **Step 1: Write the failing test**

```python
"""The capability token lives HANDOVER_TOKEN_EXPIRY_MINUTES, which is shorter than a
document-and-selfie round trip. Verification extends it once — and only once, so a caller
cannot walk a token forward indefinitely by re-requesting."""

import uuid

import pytest_asyncio

from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.orchestration.handover_service import (
    extend_token_for_verification,
    issue_capability_token,
)


@pytest_asyncio.fixture
async def seeded_phase_event(db_session, seed):
    """A CONFIRMATION phase event on an active trip at its destination stop.

    Copied from tests/integration/test_handover_endpoints.py's `handover_trip` fixture —
    there is no shared fixture for this in conftest.py, and each handover test file
    builds its own. If that file's version has drifted, follow it rather than this copy.
    """
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-VERIFY",
        operator_organization_id=seed["org"].id,
        driver_id=seed["driver"].id,
        horse_id=seed["horse"].id,
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
        status=PhaseStatus.PENDING, anchor_status=AnchorStatus.PENDING,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _token(db_session, seeded_phase_event):
    raw, token = await issue_capability_token(
        db_session,
        phase_event_id=seeded_phase_event.id,
        trip_id=seeded_phase_event.trip_id,
        trip_stop_id=seeded_phase_event.trip_stop_id,
    )
    return raw, token


async def test_extension_pushes_expiry_out_by_the_configured_cap(db_session, seeded_phase_event):
    _, token = await _token(db_session, seeded_phase_event)
    before = token.expires_at

    extended = await extend_token_for_verification(db_session, token_id=token.id)

    assert extended is True
    await db_session.refresh(token)
    delta = token.expires_at - before
    assert delta >= timedelta(minutes=settings.IDVS_TOKEN_EXTENSION_MINUTES - 1)


async def test_extension_is_refused_the_second_time(db_session, seeded_phase_event):
    _, token = await _token(db_session, seeded_phase_event)

    first = await extend_token_for_verification(db_session, token_id=token.id)
    second = await extend_token_for_verification(db_session, token_id=token.id)

    assert (first, second) == (True, False)


async def test_an_already_redeemed_token_is_not_extended(db_session, seeded_phase_event):
    _, token = await _token(db_session, seeded_phase_event)
    token.redeemed_at = datetime.now(UTC)
    await db_session.flush()

    assert await extend_token_for_verification(db_session, token_id=token.id) is False


async def test_an_unknown_token_is_not_extended(db_session):
    assert await extend_token_for_verification(db_session, token_id=uuid.uuid4()) is False
```

- [ ] **Step 2: Run it, confirm ImportError**

```bash
cd backend && .venv/bin/pytest tests/integration/test_handover_token_extension.py -v
```

Expected: FAIL — `cannot import name 'extend_token_for_verification'`
(or 4 skipped if `TEST_DATABASE_URL` is unset — **a skip is not a pass**; set it first.)

- [ ] **Step 3: Add the function to `handover_service.py`**

First check the module has a logger — at the time of writing it did **not**, and the
function below calls `logger.info()`, which would be a `NameError` on the refusal path.
If absent, add `import logging` to the import block and
`logger = logging.getLogger(__name__)` after the imports, matching every other
`orchestration/*.py` module. Then append this after `mark_token_opened`:

```python
async def extend_token_for_verification(
    db: AsyncSession, *, token_id: uuid.UUID,
) -> bool:
    """Push a token's expiry out once, to cover an identity-verification round trip.

    HANDOVER_TOKEN_EXPIRY_MINUTES is sized for a receiver who types a name and swipes. A
    document scan plus a live face check on a stranger's phone can outlast it, and a token
    that dies mid-verification strands the delivery behind a generic 404 the receiver has
    no way to recover from.

    ONE shot, enforced by the database, not by the caller. The conditional
    `WHERE verification_extended_at IS NULL` is what makes a second request a no-op, so a
    client cannot walk a token forward indefinitely by asking again — the same
    single-claim idiom mark_token_opened uses on opened_at, for the same reason.

    Refuses a redeemed token: once a delivery is confirmed the grant is spent, and
    extending it would resurrect a credential that should be dead.

    Returns True if this call performed the extension, False otherwise (already extended,
    redeemed, or unknown) — never raises, because the caller degrades the evidence tier
    on False rather than failing the handover.
    """
    now = datetime.now(UTC)
    extended = (
        await db.execute(
            update(HandoverCapabilityToken)
            .where(
                HandoverCapabilityToken.id == token_id,
                HandoverCapabilityToken.verification_extended_at.is_(None),
                HandoverCapabilityToken.redeemed_at.is_(None),
            )
            .values(
                verification_extended_at=now,
                expires_at=HandoverCapabilityToken.expires_at
                + timedelta(minutes=settings.IDVS_TOKEN_EXTENSION_MINUTES),
            )
            .returning(HandoverCapabilityToken.id)
        )
    ).scalar_one_or_none()
    await db.flush()

    if extended is None:
        logger.info("Token extension refused for token=%s (already extended, redeemed or unknown)", token_id)
        return False
    return True
```

- [ ] **Step 4: Add the column this depends on**

In `backend/app/db/models/handover.py`, inside `HandoverCapabilityToken`, after `opened_at`:

```python
    # Set the one time this token's life was extended to cover an identity verification
    # (spec §6.3). Its NULL-ness is the gate, not a flag a caller checks: the conditional
    # UPDATE in extend_token_for_verification keys on it, so the extension is
    # single-claim at the database exactly as opened_at is.
    verification_extended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```

**`handover.py` is Tim's file from FP-155 but is now shared surface — flag it in TASK COMPLETE.**

- [ ] **Step 5: Run the tests**

```bash
cd backend && .venv/bin/pytest tests/integration/test_handover_token_extension.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Stage**

```bash
git add backend/app/orchestration/handover_service.py backend/app/db/models/handover.py backend/tests/integration/test_handover_token_extension.py
```

Suggested message: `feat(orchestration): bounded one-shot capability token extension for verification`

---

## Task 3: Tier and exception mapping (pure)

**Files:**
- Modify: `backend/app/orchestration/receiver_verification_service.py`
- Test: `backend/tests/unit/test_receiver_verification_tiers.py`

- [ ] **Step 1: Write the failing test**

```python
"""Mapping a vendor decision + cross-check result onto our own verdict.

The distinction this file exists to protect: a GAP (no check completed) and a MISMATCH
(a check completed and disagreed) are different facts and raise different exceptions —
the same separation enums.py already draws between SEAL_UNVERIFIED and SEAL_MISMATCH."""

from app.db.models.enums import (
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.integrations.idvs import IdvsDecisionStatus
from app.orchestration.receiver_verification_service import resolve_verdict


def test_approved_and_matching_identity_is_verified():
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=True)

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.tier is ReceiverVerificationTier.DOCUMENT_AND_FACE
    assert v.exception_type is None


def test_approved_but_mismatched_identity_is_failed_and_raises_mismatch():
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=False)

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.exception_type is ExceptionType.RECEIVER_ID_MISMATCH


def test_declined_is_failed_and_raises_mismatch():
    v = resolve_verdict(status=IdvsDecisionStatus.DECLINED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.exception_type is ExceptionType.RECEIVER_ID_MISMATCH


def test_approved_with_nothing_to_compare_is_verified_not_failed():
    """identity_match is None when the vendor returned no document data. That is an
    absence of evidence, not evidence of mismatch."""
    v = resolve_verdict(status=IdvsDecisionStatus.APPROVED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.exception_type is None


def test_abandoned_is_unverified_and_raises_the_gap_exception():
    v = resolve_verdict(status=IdvsDecisionStatus.ABANDONED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.unverified_reason is ReceiverVerificationUnverifiedReason.ABANDONED
    assert v.exception_type is ExceptionType.RECEIVER_ID_UNVERIFIED


def test_expired_is_unverified_and_raises_the_gap_exception():
    v = resolve_verdict(status=IdvsDecisionStatus.EXPIRED, identity_match=None)

    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.exception_type is ExceptionType.RECEIVER_ID_UNVERIFIED


def test_a_non_terminal_status_stays_pending_and_raises_nothing_yet():
    v = resolve_verdict(status=IdvsDecisionStatus.IN_PROGRESS, identity_match=None)

    assert v.status is ReceiverVerificationStatus.PENDING
    assert v.exception_type is None
```

- [ ] **Step 2: Run, confirm ImportError**

```bash
cd backend && .venv/bin/pytest tests/unit/test_receiver_verification_tiers.py -v
```

Expected: FAIL — `cannot import name 'resolve_verdict'`

- [ ] **Step 3: Add `Verdict` and `resolve_verdict` to `receiver_verification_service.py`**

```python
@dataclass(frozen=True)
class Verdict:
    """What we concluded, derived from what the vendor said plus our own cross-check.

    Separate from IdvsDecision on purpose: that is the vendor's vocabulary, this is ours,
    and the mapping between them is a judgement this module owns rather than something a
    parser should be making.
    """

    status: ReceiverVerificationStatus
    tier: ReceiverVerificationTier
    unverified_reason: Optional[ReceiverVerificationUnverifiedReason] = None
    exception_type: Optional[ExceptionType] = None


def resolve_verdict(
    *, status: IdvsDecisionStatus, identity_match: Optional[bool],
) -> Verdict:
    """Map a vendor status and cross-check result onto our verdict and its exception.

    Two rules do all the work here, and both are the spec's:

    1. A GAP is not a MISMATCH. ABANDONED and EXPIRED mean no check completed, which has
       benign readings (lost signal, walked away) and raises RECEIVER_ID_UNVERIFIED.
       DECLINED and a failed cross-check mean a check completed and disagreed, which does
       not, and raises RECEIVER_ID_MISMATCH. Conflating them would put false positives in
       front of a dispatcher triaging a real investigation — the reasoning enums.py
       already records for SEAL_UNVERIFIED versus SEAL_MISMATCH.

    2. identity_match None means there was nothing to compare, NOT that it disagreed.
       An APPROVED session with no extracted document data is still VERIFIED; treating
       absence of evidence as evidence of fraud would manufacture mismatches out of a
       vendor's field coverage.

    A non-terminal status yields PENDING and no exception. Nothing is raised for a check
    still in flight — the sweeper terminalises it later, and only then is there a fact.
    """
    if not status.is_terminal:
        return Verdict(
            status=ReceiverVerificationStatus.PENDING,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.APPROVED:
        if identity_match is False:
            return Verdict(
                status=ReceiverVerificationStatus.FAILED,
                tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
                exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
            )
        return Verdict(
            status=ReceiverVerificationStatus.VERIFIED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        )

    if status is IdvsDecisionStatus.DECLINED:
        return Verdict(
            status=ReceiverVerificationStatus.FAILED,
            tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
            exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
        )

    # ABANDONED / EXPIRED — the gap case.
    return Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        # Both ABANDONED and EXPIRED map here. The enum has no EXPIRED member on
        # purpose: from the evidence record's point of view "they walked away" and "the
        # link aged out" are the same fact — no check completed — and inventing two
        # reasons would imply a distinction a dispatcher cannot act on differently.
        unverified_reason=ReceiverVerificationUnverifiedReason.ABANDONED,
        exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
    )
```

Add these imports at the top of the module:

```python
from dataclasses import dataclass

from app.db.models.enums import (
    ExceptionType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)
from app.integrations.idvs import IdvsDecisionStatus
```

- [ ] **Step 4: Run**

```bash
cd backend && .venv/bin/pytest tests/unit/test_receiver_verification_tiers.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/receiver_verification_service.py backend/tests/unit/test_receiver_verification_tiers.py
```

Suggested message: `feat(orchestration): map vendor decisions onto verification verdicts`

---

## Task 4: Raise the verification exception

**Files:**
- Modify: `backend/app/orchestration/receiver_verification_service.py`

- [ ] **Step 1: Add the raiser**

```python
async def raise_verification_exception(
    db: AsyncSession,
    *,
    trip: Trip,
    phase_event_id: uuid.UUID,
    trip_stop_id: Optional[uuid.UUID],
    verdict: Verdict,
) -> None:
    """Record a verification finding as a TripException, and tell the dispatcher.

    Severity follows the gap/mismatch split rather than being uniform. A MISMATCH is a
    fraud indicator with no benign reading and gets WARNING; an UNVERIFIED gap gets INFO,
    because "the receiver had no ID on them" is an ordinary Tuesday on a warehouse floor
    and does not belong in the same lane as a disagreeing document. Putting a class of
    finding with real false-positive modes into the alarm lane is how a dispatcher learns
    to ignore the alarm lane — the reasoning phase_service.py records for GPS_MISMATCH.

    Never CRITICAL. This codebase reserves that for findings that stop a trip — a seal
    mismatch, a panic button — and an identity check cannot, by the spec's own rule that
    verification never gates a delivery.

    Broad except, logged with a traceback: the receiver has already confirmed, and a
    failure to file paperwork about it must not unwind a delivery that happened.
    """
    if verdict.exception_type is None:
        return

    severity = (
        ExceptionSeverity.WARNING
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else ExceptionSeverity.INFO
    )
    description = (
        "The identity presented by the receiver did not match the verified document."
        if verdict.exception_type is ExceptionType.RECEIVER_ID_MISMATCH
        else (
            "The receiver's identity could not be verified at handover "
            f"({verdict.unverified_reason.value if verdict.unverified_reason else 'unknown'})."
        )
    )

    try:
        db.add(TripException(
            trip_id=trip.id,
            phase_event_id=phase_event_id,
            trip_stop_id=trip_stop_id,
            exception_type=verdict.exception_type,
            source=ExceptionSource.SYSTEM,
            severity=severity,
            review_status=initial_review_status(severity),
            description=description,
        ))
        await db.flush()

        # FP-147's invariant: a system-detected exception that tells no one leaves the
        # dispatcher's screen showing a trip that no longer matches the record.
        enqueue_event(
            db, trip.operator_organization_id,
            TripEvent(
                id=trip.id,
                kind=RealtimeKind.EXCEPTION_RAISED,
                severity=event_severity(severity),
            ),
        )
    except Exception:
        logger.exception(
            "Could not record a receiver verification exception for trip=%s phase_event=%s "
            "— the verification row still carries the finding",
            trip.id, phase_event_id,
        )
```

Imports to add:

```python
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import ExceptionSeverity, ExceptionSource
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.orchestration.exception_service import initial_review_status
```

- [ ] **Step 2: Confirm imports resolve**

```bash
cd backend && .venv/bin/python -c "from app.orchestration.receiver_verification_service import raise_verification_exception; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Check for a circular import**

`exception_service` and `receiver_verification_service` are both in `orchestration/`. If
step 2 raises `ImportError: cannot import name ... (most likely due to a circular import)`,
move `initial_review_status` into a shared module rather than importing it lazily inside
the function — a local import hides the cycle instead of removing it. Report this if it
happens; it changes a file this plan does not otherwise touch.

- [ ] **Step 4: Stage**

```bash
git add backend/app/orchestration/receiver_verification_service.py
```

Suggested message: `feat(orchestration): raise receiver verification exceptions with realtime notify`

---

## Task 5: Lifecycle — consent, start, resolve, attach

**Files:**
- Modify: `backend/app/orchestration/receiver_verification_service.py`
- Test: `backend/tests/integration/test_receiver_verification_service.py`

- [ ] **Step 1: Write the failing integration test**

```python
"""The verification lifecycle against a real database, with the mock vendor.

The ordering assertion matters most: a verification row exists BEFORE any confirmation
row does, which is the whole reason Task 1 re-keyed it onto the token."""

import hashlib
import uuid

import pytest_asyncio

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationUnverifiedReason,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.integrations.idvs import IdvsDecisionStatus, MockIdvsClient
from app.orchestration.handover_service import issue_capability_token
from app.orchestration.receiver_verification_service import (
    record_consent,
    start_verification,
)

_CONSENT = "I agree to my identity document and photograph being checked."


@pytest_asyncio.fixture
async def seeded_phase_event(db_session, seed):
    """A CONFIRMATION phase event on an active trip at its destination stop.

    Copied from tests/integration/test_handover_endpoints.py's `handover_trip` fixture —
    there is no shared fixture for this in conftest.py, and each handover test file
    builds its own. If that file's version has drifted, follow it rather than this copy.
    """
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-VERIFY",
        operator_organization_id=seed["org"].id,
        driver_id=seed["driver"].id,
        horse_id=seed["horse"].id,
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
        status=PhaseStatus.PENDING, anchor_status=AnchorStatus.PENDING,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _fresh_token(db_session, seeded_phase_event):
    return await issue_capability_token(
        db_session,
        phase_event_id=seeded_phase_event.id,
        trip_id=seeded_phase_event.trip_id,
        trip_stop_id=seeded_phase_event.trip_stop_id,
    )


async def test_consent_creates_a_pending_row_keyed_on_the_token(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)

    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    assert v.token_id == token.id
    assert v.handover_confirmation_id is None, "no confirmation exists yet — this is the point"
    assert v.status is ReceiverVerificationStatus.PENDING


async def test_consent_records_the_hash_of_the_wording_not_the_wording(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)

    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    assert v.consent_text_hash == hashlib.sha256(_CONSENT.encode("utf-8")).hexdigest()
    assert v.consent_given_at is not None


async def test_start_verification_returns_a_session_and_stores_its_id(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    session = await start_verification(
        db_session, token=token, verification=v, client=MockIdvsClient(),
    )

    assert session is not None
    assert v.provider_session_id == session.session_id


async def test_quota_exhaustion_degrades_without_calling_the_vendor(
    db_session, seeded_phase_event, monkeypatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 0)
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    session = await start_verification(
        db_session, token=token, verification=v, client=MockIdvsClient(),
    )

    assert session is None
    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.unverified_reason is ReceiverVerificationUnverifiedReason.QUOTA_EXHAUSTED
    assert v.provider_session_id is None, "no session may be created once the quota is spent"
```

- [ ] **Step 2: Run, confirm ImportError**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_service.py -v
```

Expected: FAIL — `cannot import name 'record_consent'`

- [ ] **Step 3: Add the lifecycle functions**

```python
def hash_consent_text(consent_text: str) -> str:
    """SHA-256 of the exact wording shown to the receiver.

    The hash, never the text. An s27(1)(a) consent basis is only as good as proof of WHAT
    was agreed to, and hashing makes that provable without copying the paragraph into
    every row — which also makes the wording versioned content rather than a UI string
    somebody edits freely.
    """
    return hashlib.sha256(consent_text.encode("utf-8")).hexdigest()


async def record_consent(
    db: AsyncSession, *, token: HandoverCapabilityToken, consent_text: str,
) -> ReceiverIdentityVerification:
    """Create the verification row at the moment the receiver consents.

    Before any vendor call and before any confirmation exists. The row starts PENDING with
    a token_id and no handover_confirmation_id — see the model's docstring for why that
    ordering is the design rather than an oversight.
    """
    verification = ReceiverIdentityVerification(
        id=uuid.uuid4(),
        token_id=token.id,
        trip_id=token.trip_id,
        status=ReceiverVerificationStatus.PENDING,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        provider=PROVIDER_DIDIT,
        consent_given_at=datetime.now(UTC),
        consent_text_hash=hash_consent_text(consent_text),
    )
    db.add(verification)
    await db.flush()
    return verification


async def start_verification(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    verification: ReceiverIdentityVerification,
    client: IdvsClient,
) -> Optional[IdvsSession]:
    """Claim quota, create a vendor session, and extend the token to cover it.

    Quota is claimed BEFORE the vendor call, never after. The whole point of the hard stop
    is that session 501 is never created — checking afterwards would mean paying for the
    thing we decided not to buy.

    Returns None on every degradation path. The caller sends the receiver down the tier
    ladder instead of failing: a vendor outage, a spent quota and an unreachable network
    all end with a confirmable delivery carrying an honest reason.
    """
    if not await consume_quota_slot(db, provider=PROVIDER_DIDIT):
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.QUOTA_EXHAUSTED
        await db.flush()
        return None

    try:
        session = await client.create_session(reference=str(verification.id))
    except IdvsError:
        logger.exception("IDVS session creation failed for verification=%s", verification.id)
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.VENDOR_UNAVAILABLE
        await db.flush()
        return None

    # Persisted BEFORE the receiver is redirected. This is the security rule in spec §7.1:
    # the client never names a session, so it can never substitute somebody else's
    # approved one — we only ever fetch a decision for the id we stored ourselves.
    verification.provider_session_id = session.session_id
    await db.flush()

    # Best-effort. A token that cannot be extended still works; it just gives the receiver
    # less time, which degrades the tier rather than failing the handover.
    await extend_token_for_verification(db, token_id=token.id)

    return session
```

Imports to add:

```python
import hashlib
import uuid
from datetime import UTC, datetime

from app.db.models.handover import HandoverCapabilityToken
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.integrations.idvs import IdvsClient, IdvsError, IdvsSession
from app.orchestration.handover_service import extend_token_for_verification
```

- [ ] **Step 4: Run**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_service.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/receiver_verification_service.py backend/tests/integration/test_receiver_verification_service.py
```

Suggested message: `feat(orchestration): receiver verification consent and session lifecycle`

---

## Task 6: Resolve and attach

**Files:**
- Modify: `backend/app/orchestration/receiver_verification_service.py`
- Modify: `backend/tests/integration/test_receiver_verification_service.py`

- [ ] **Step 1: Append the failing tests**

```python
from app.orchestration.receiver_verification_service import (
    attach_confirmation,
    resolve_verification,
)


async def test_resolve_fetches_the_decision_for_our_stored_session_id(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.provider_decision_at is not None


async def test_a_declined_session_is_failed_not_unverified(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)
    await client.stage_decision(v.provider_session_id, status=IdvsDecisionStatus.DECLINED)

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.FAILED


async def test_extracted_identity_disagreeing_with_typed_identity_fails(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)
    await client.stage_decision(
        v.provider_session_id,
        status=IdvsDecisionStatus.APPROVED,
        extracted_surname="Dlamini",
        extracted_id_number="8801015800085",
    )

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.identity_match is False


async def test_attach_confirmation_links_the_row_after_the_receiver_signs(db_session, seeded_phase_event):
    import uuid as _uuid
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    fake_confirmation_id = _uuid.uuid4()

    await attach_confirmation(
        db_session, token_id=token.id, handover_confirmation_id=fake_confirmation_id,
    )

    await db_session.refresh(v)
    assert v.handover_confirmation_id == fake_confirmation_id
```

> Note: the last test uses a synthetic UUID because it only exercises the link write. A
> real end-to-end confirm flow is Stage 2B's integration test, where a genuine
> `handover_confirmations` row exists. If the FK is enforced in your test database this
> test will fail — in that case create a real confirmation row via
> `handover_service.record_handover_confirmation` and use its id.

- [ ] **Step 2: Run, confirm ImportError**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_service.py -v
```

Expected: FAIL — `cannot import name 'attach_confirmation'`

- [ ] **Step 3: Add both functions**

```python
async def resolve_verification(
    db: AsyncSession,
    *,
    verification: ReceiverIdentityVerification,
    client: IdvsClient,
    typed_name: str,
    typed_id_number: str,
) -> Verdict:
    """Fetch the authoritative decision and write our verdict.

    THE security boundary of this feature. The session id comes from our own row, never
    from the caller — spec §7.1, and the exact failure Didit's own team patched in their
    WordPress plugin, where a browser could post {status: "Approved"} and be believed.
    Our receiver route is unauthenticated by design, so trusting a client-supplied status
    would let anyone holding a live QR self-declare VERIFIED.

    A vendor that cannot be reached leaves the row PENDING rather than guessing. The
    sweeper terminalises it later; inventing a verdict here would put a fact in the
    evidence record that nobody established.
    """
    if verification.provider_session_id is None:
        return Verdict(
            status=ReceiverVerificationStatus.UNVERIFIED,
            tier=verification.tier,
            unverified_reason=ReceiverVerificationUnverifiedReason.VENDOR_UNAVAILABLE,
            exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
        )

    try:
        decision = await client.get_decision(verification.provider_session_id)
    except IdvsError:
        logger.exception(
            "IDVS decision fetch failed for verification=%s — left PENDING for the sweeper",
            verification.id,
        )
        return Verdict(status=ReceiverVerificationStatus.PENDING, tier=verification.tier)

    match = identity_matches(
        typed_name=typed_name,
        typed_id_number=typed_id_number,
        extracted_surname=decision.extracted_surname,
        extracted_id_number=decision.extracted_id_number,
    )
    verdict = resolve_verdict(status=decision.status, identity_match=match)

    verification.identity_match = match
    verification.status = verdict.status
    verification.tier = verdict.tier
    verification.unverified_reason = verdict.unverified_reason
    verification.provider_decision_at = decision.decided_at
    await db.flush()

    return verdict


async def attach_confirmation(
    db: AsyncSession, *, token_id: uuid.UUID, handover_confirmation_id: uuid.UUID,
) -> None:
    """Link a verification to the confirmation the receiver went on to sign.

    Separate from record_consent because the two happen at different moments and a
    receiver may verify and then walk away. A verification with a NULL
    handover_confirmation_id is not an error state — it is the honest record of someone
    who proved who they were and then did not sign.
    """
    await db.execute(
        update(ReceiverIdentityVerification)
        .where(ReceiverIdentityVerification.token_id == token_id)
        .values(handover_confirmation_id=handover_confirmation_id)
    )
    await db.flush()
```

- [ ] **Step 4: Run the whole file**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_service.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/receiver_verification_service.py backend/tests/integration/test_receiver_verification_service.py
```

Suggested message: `feat(orchestration): resolve verification decisions server-side and link confirmations`

---

## Task 7: Full suite and handoff

- [ ] **Step 1: Confirm `TEST_DATABASE_URL` is set** — most of this plan is integration tests, and **a skip is not a pass**.

```bash
cd backend && .venv/bin/python -c "from app.core.config import settings; print('SET' if settings.TEST_DATABASE_URL else 'NOT SET — the tests below prove nothing')"
```

- [ ] **Step 2: Run everything**

```bash
cd backend && .venv/bin/pytest
```

Expected: green, with the new integration tests **passing, not skipping**.

- [ ] **Step 3: Confirm layering**

```bash
cd backend && grep -nE "from app\.(api|integrations)" app/orchestration/receiver_verification_service.py
```

`app.integrations.idvs` is expected and allowed (orchestration → integrations). Any
`app.api` import is a violation.

- [ ] **Step 4: Report TASK COMPLETE** per `CLAUDE.md`, flagging:
  - Shared files: `db/models/handover.py` (FP-155 surface), `db/models/receiver_verification.py`
  - That the Stage 1 migration must be **regenerated**, not amended (Task 1)
  - Nothing committed

---

## Stage 2A done when

- [ ] `pytest` green with integration tests **executing**
- [ ] A verification row can exist with `handover_confirmation_id IS NULL`
- [ ] Quota exhaustion creates no vendor session
- [ ] `resolve_verification` accepts no session id from any caller
- [ ] Gap and mismatch raise different exception types at different severities
- [ ] Nothing committed; everything staged

## Not in this stage

The four HTTP routes, the signed webhook, the abandonment sweeper, and the receiver UI.
Stage 2B and Stage 3.
