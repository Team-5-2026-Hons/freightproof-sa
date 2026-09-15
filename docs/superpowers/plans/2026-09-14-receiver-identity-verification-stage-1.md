# Receiver Identity Verification — Stage 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠ GIT RULE — overrides the skill's default.** `CLAUDE.md` forbids Claude running
> `git commit`, `git push`, `git merge`, `git rebase`, `git checkout <branch>`, `git reset`
> or `git restore`. Every "commit" step below therefore **stages only** (`git add` on
> named files) and hands the developer a suggested message. Do not commit.

**Goal:** Build the data layer, configuration and vendor client for receiver identity
verification — everything Stage 2's service and endpoints will sit on — fully unit-tested
against a mock, with no network calls and no vendor account required.

**Architecture:** A new `integrations/idvs.py` follows the `pulsit.py` pattern exactly: a
`Protocol`, a Redis-backed mock selected by `IDVS_USE_MOCK`, an HTTP client, and a
factory. Two new tables record the verification outcome and meter the free-tier quota.
The quota counter is an atomic conditional `UPDATE`, matching the concurrency idiom
`redeem_capability_token` already establishes.

**Tech Stack:** Python 3.13, FastAPI 0.115+, SQLAlchemy 2.0 async (`Mapped`/`mapped_column`),
Pydantic v2, Alembic, pytest + pytest-asyncio (`asyncio_mode = auto`), httpx, Redis.

**Spec:** `docs/superpowers/specs/2026-09-14-receiver-identity-verification-design.md`

**Scope:** Spec §16 Stage 1 only. Stage 2 (service + endpoints + webhook) and Stage 3
(receiver UI) get their own plans. Nothing here is reachable over HTTP yet — that is
intentional and is what makes this stage independently reviewable.

---

## Before you start

- [ ] **Confirm you are NOT on `dev` or `main`.** Both are branch-protected.

```bash
git branch --show-current
```

Expected: a feature branch. If it prints `dev`, stop and ask the developer to branch.

- [ ] **Confirm the test database is configured.** The suite silently skips without it.

```bash
cd backend && python -c "import os; print('TEST_DATABASE_URL' in os.environ or 'set in .env')"
```

- [ ] **Check for unmerged migrations before touching Alembic** (`CLAUDE.md`, 4 devs):

```bash
git fetch origin && git log --oneline origin/dev -- backend/migrations/versions/ | head -5
```

If anything landed on `dev` that you do not have, rebase **before** Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/db/models/enums.py` *(modify)* | Four new enums + two `ExceptionType` members |
| `backend/app/db/models/receiver_verification.py` *(create)* | `ReceiverIdentityVerification`, `IdvsQuotaLedger` |
| `backend/app/db/models/__init__.py` *(modify)* | Register both models |
| `backend/migrations/versions/2026_09_<dd>_tim_add_receiver_verification.py` *(create)* | Both tables |
| `backend/app/core/config.py` *(modify, **shared**)* | Six new `IDVS_*` settings |
| `backend/.env.example` *(modify, **shared**)* | Key names only, never values |
| `backend/app/core/limits.py` *(modify, **shared**)* | `IDVS_VERIFY` budget |
| `backend/app/integrations/idvs.py` *(create)* | Vendor client: types, Protocol, mock, HTTP, factory |
| `backend/app/orchestration/receiver_verification_service.py` *(create)* | Quota ledger + identity cross-check only in this stage |
| `backend/tests/unit/test_idvs_client.py` *(create)* | Mock client behaviour, Didit response parsing |
| `backend/tests/unit/test_receiver_identity_match.py` *(create)* | Cross-check normalisation |
| `backend/tests/integration/test_idvs_quota_ledger.py` *(create)* | Atomic quota consumption |

---

## Task 1: Enums

**Files:**
- Modify: `backend/app/db/models/enums.py`

- [ ] **Step 1: Add the four verification enums**

Append after the `IdvsStatus` class (around line 204):

```python
class ReceiverVerificationStatus(str, enum.Enum):
    """Where one receiver's identity check ended up.

    PENDING exists only while a Didit session is in flight. The spec's invariant is that
    no trip reaches a terminal state with a PENDING row still open — the sweeper and the
    phase-completion hook in Stage 2 are what enforce that, not this enum.
    """

    PENDING    = "pending"
    VERIFIED   = "verified"
    FAILED     = "failed"
    UNVERIFIED = "unverified"


class ReceiverVerificationTier(str, enum.Enum):
    """How much evidence the check actually produced.

    SELFIE_ONLY is presence evidence, not identity evidence: a live face with no document
    to match against proves a human confirmed, never who they were.
    """

    DOCUMENT_AND_FACE = "document_and_face"
    SELFIE_ONLY       = "selfie_only"
    TYPED_ONLY        = "typed_only"


class ReceiverVerificationUnverifiedReason(str, enum.Enum):
    """Why a check did not reach a verdict.

    Never free text, for the reason HandoverTokenRejectionReason gives: the evidence has
    to stay queryable, and a dispatcher triaging deliveries needs to separate "the
    receiver had no ID on them" from "our vendor was down".
    """

    NO_DOCUMENT       = "no_document"
    DECLINED_CONSENT  = "declined_consent"
    NO_CONNECTION     = "no_connection"
    QUOTA_EXHAUSTED   = "quota_exhausted"
    VENDOR_UNAVAILABLE = "vendor_unavailable"
    ABANDONED         = "abandoned"
```

- [ ] **Step 2: Add the two exception types**

In the existing `ExceptionType` enum, after `WAYBILL_COUNT_MISMATCH`:

```python
    # Kept apart for the reason SEAL_UNVERIFIED and SEAL_MISMATCH are kept apart, a few
    # lines above. MISMATCH asserts an identity was checked and disagreed — a fraud
    # indicator. UNVERIFIED means no check completed, which is a gap in the chain and has
    # several benign readings (no ID on them, no signal, quota spent). Conflating them
    # puts false positives in front of a dispatcher triaging a real investigation.
    RECEIVER_ID_MISMATCH   = "receiver_id_mismatch"
    RECEIVER_ID_UNVERIFIED = "receiver_id_unverified"
```

- [ ] **Step 3: Verify the module imports**

```bash
cd backend && python -c "from app.db.models.enums import ReceiverVerificationStatus, ReceiverVerificationTier, ReceiverVerificationUnverifiedReason, ExceptionType; print(ExceptionType.RECEIVER_ID_MISMATCH.value)"
```

Expected: `receiver_id_mismatch`

- [ ] **Step 4: Stage**

```bash
git add backend/app/db/models/enums.py
```

Suggested message: `feat(db): add receiver verification enums and exception types`

---

## Task 2: Models

**Files:**
- Create: `backend/app/db/models/receiver_verification.py`
- Modify: `backend/app/db/models/__init__.py`

- [ ] **Step 1: Write the model module**

Create `backend/app/db/models/receiver_verification.py`:

```python
"""Receiver identity verification via Didit, and the free-tier quota that meters it.

FP-155 records what the receiver TYPED. This records whether that identity was checked,
by whom, and what came back — or, far more often than is comfortable, exactly why it
could not be.

What is deliberately NOT here is the point of the design. No document image, no face
image, no ID number extracted by the vendor. Didit holds those; we hold a decision and a
session reference, which is what the architecture doc means by "does not replicate
identity data". The cost is real and is recorded in the spec: in a dispute the underlying
images must be re-queried from the vendor rather than read locally.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import (
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
)


class ReceiverIdentityVerification(Base):
    """One identity check against one handover confirmation.

    The unique constraint on handover_confirmation_id is what makes "a delivery is
    verified at most once" true at the database rather than at the application's word —
    the same reasoning HandoverConfirmation applies to its own phase_event_id.
    """

    __tablename__ = "receiver_identity_verifications"
    __table_args__ = (
        UniqueConstraint(
            "handover_confirmation_id",
            name="uq_receiver_identity_verifications_confirmation_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    handover_confirmation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_confirmations.id"), nullable=False
    )
    # Denormalised off the confirmation so a dispatcher's trip view resolves a
    # verification with one row read, matching what HandoverCapabilityToken does with
    # trip_id for the same reason.
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)

    status: Mapped[ReceiverVerificationStatus] = mapped_column(String(20), nullable=False)
    tier: Mapped[ReceiverVerificationTier] = mapped_column(String(20), nullable=False)
    unverified_reason: Mapped[Optional[ReceiverVerificationUnverifiedReason]] = mapped_column(
        String(30), nullable=True
    )

    # Recorded even though only one provider exists today, so a future swap leaves old
    # rows legible about which vendor actually produced their verdict.
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    # Generated by us and persisted BEFORE the receiver is redirected. The client never
    # gets to name a session, which is what stops it substituting somebody else's
    # approved one — see the spec's "never trust the browser" rule.
    provider_session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    provider_decision_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Whether the vendor's extracted identity agreed with what the receiver typed. NULL
    # when no document data exists to compare (every tier below DOCUMENT_AND_FACE).
    # False is the substitution signal: a single-use link stops replay, not a confederate
    # completing the flow with their own genuine ID before the receiver opens it.
    identity_match: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # SELFIE_ONLY tier only. Our own capture, stored in af-south-1 like every other
    # artifact — never sent to the vendor, so it never enters the s26 biometric regime.
    selfie_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=True
    )

    # POPIA s27(1)(a). Biometric processing is prohibited without an exemption, and
    # explicit consent is the one we rely on — so the consent is evidence in its own
    # right. The HASH, not the text: it proves WHICH wording was agreed to without
    # duplicating the copy into every row, which is what makes the wording versioned
    # content rather than a UI string somebody edits freely.
    consent_given_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_text_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # A webhook that lands after this row terminalised does NOT move `status` — that
    # would break the spec's invariant and let a closed trip be rewritten. It is kept
    # here instead, following the rule the rest of this codebase applies to every
    # inconvenient finding: record it, do not refuse it and forget it happened.
    late_decision_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    late_decision_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IdvsQuotaLedger(Base):
    """How many free vendor sessions this calendar month has already spent.

    One row per (period, provider). The team's decision is a HARD stop: at the limit we
    stop calling the vendor and degrade the handover, rather than letting session 501
    silently bill. That makes this row a spending control, not a statistic.

    `period` is UTC, and the comment matters more than the column: Didit resets its free
    quota at 00:00 UTC, which is 02:00 SAST. Keying this on local time would roll the
    counter two hours late every month and bill for the gap.
    """

    __tablename__ = "idvs_quota_ledger"
    __table_args__ = (
        UniqueConstraint("period", "provider", name="uq_idvs_quota_ledger_period_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # "YYYY-MM", UTC. A string rather than a date because the whole month is the unit;
    # storing a date would invite a range query that gets the boundary wrong.
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    sessions_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] **Step 2: Register both models**

Append to `backend/app/db/models/__init__.py`, after the `handover` import block:

```python
from app.db.models.receiver_verification import (  # noqa: E402,F401
    IdvsQuotaLedger,
    ReceiverIdentityVerification,
)
```

- [ ] **Step 3: Verify registration**

```bash
cd backend && python -c "
from app.db.models import Base
names = set(Base.metadata.tables)
assert 'receiver_identity_verifications' in names, names
assert 'idvs_quota_ledger' in names, names
print('registered')
"
```

Expected: `registered`

- [ ] **Step 4: Stage**

```bash
git add backend/app/db/models/receiver_verification.py backend/app/db/models/__init__.py
```

Suggested message: `feat(db): add receiver identity verification and quota ledger models`

---

## Task 3: Migration

**Files:**
- Create: `backend/migrations/versions/2026_09_<dd>_tim_add_receiver_verification.py`

- [ ] **Step 1: Re-check for migration conflicts**

```bash
cd /Users/timgultig/freightproof-sa && git fetch origin && git log --oneline HEAD..origin/dev -- backend/migrations/versions/
```

Expected: empty. **If it prints anything, stop** — rebase first, and per `CLAUDE.md` do
not repair a revision chain yourself; flag it and coordinate.

- [ ] **Step 2: Autogenerate**

```bash
cd backend && alembic revision --autogenerate -m "tim add receiver verification"
```

- [ ] **Step 3: Rename the file to the team convention**

```bash
cd backend/migrations/versions && ls -t | head -1
# rename that file to 2026_09_<dd>_tim_add_receiver_verification.py, keeping the
# revision identifiers inside the file untouched.
```

- [ ] **Step 4: Read the generated file and confirm it creates exactly two tables**

It must create `receiver_identity_verifications` and `idvs_quota_ledger` with both unique
constraints, and **nothing else**. Autogenerate picks up drift from other developers'
models; delete any operation that is not one of these two tables.

- [ ] **Step 5: Do NOT apply it. Hand the apply decision to the developer.**

`migrations/env.py:27` points Alembic at `settings.DATABASE_URL`, which is the **shared
Supabase dev database** — not a local one. Applying a migration there changes schema for
three other developers, so it is the developer's call, not an agent's.

The test suite is unaffected either way: `tests/conftest.py` builds schema with
`Base.metadata.create_all`, so integration tests pass from the models alone.

Verify by inspection instead:

```bash
cd backend && .venv/bin/python -c "import ast; ast.parse(open('migrations/versions/<file>.py').read()); print('parses')"
```

Then report to the developer, for them to run when they choose:

```bash
cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

The down-then-up is what proves the downgrade works. CI never runs Alembic, so that
round trip is the only place it is ever tested — but it must be run by a human who knows
which database they are pointed at.

- [ ] **Step 6: Stage**

```bash
git add backend/migrations/versions/
```

Suggested message: `feat(db): migration for receiver verification tables`

---

## Task 4: Configuration

**Files:**
- Modify: `backend/app/core/config.py` **(shared — flag in TASK COMPLETE)**
- Modify: `backend/.env.example` **(shared)**
- Modify: `backend/app/core/limits.py` **(shared)**

- [ ] **Step 1: Add the settings**

In `config.py`, after the `HANDOVER_RECEIVER_BASE_URL` block:

```python
    # -------------------------------------------------------------------------
    # Receiver identity verification (Didit)
    # -------------------------------------------------------------------------
    # The Didit workflow selecting the full KYC bundle — document + passive liveness +
    # face match + IP. Server-side config rather than a per-request choice, so the
    # verification a receiver gets cannot be downgraded by anything the client sends.
    IDVS_WORKFLOW_ID: str = ""

    # HMAC secret for the vendor's webhook. The webhook is a public write-capable route,
    # and this is the only thing separating a real decision from a forged one.
    IDVS_WEBHOOK_SECRET: str = ""

    # HARD stop, not a warning threshold. Didit's free tier is 500 sessions per calendar
    # month and session 501 bills silently with no rate limit at the boundary, so the
    # limit has to be enforced on our side or not at all. At the ceiling the handover
    # degrades to a lower evidence tier; it never bills and it never blocks a delivery.
    IDVS_MONTHLY_SESSION_LIMIT: int = 500

    # Ceiling on the outbound session-creation call. Deliberately short: a receiver is
    # standing in a warehouse with a driver waiting, and a slow vendor must degrade the
    # tier rather than hold up the handover.
    IDVS_SESSION_TIMEOUT_SECONDS: int = 10

    # How long the receiver's browser waits for a decision after returning from the
    # vendor before giving up and recording ABANDONED. Bounds the handover so a trip can
    # never end with a verification still in flight.
    IDVS_DECISION_POLL_SECONDS: int = 90

    # One-shot extension of the capability token's life when a verification starts.
    # The token expires in HANDOVER_TOKEN_EXPIRY_MINUTES, which is shorter than a
    # document-and-selfie round trip can take; without this a slow verification would
    # burn the grant and leave the delivery unconfirmable behind a generic 404.
    # Applied once, capped, and only to a token a human has demonstrably opened.
    IDVS_TOKEN_EXTENSION_MINUTES: int = 10
```

- [ ] **Step 2: Add key names to `.env.example`** (names only — never values):

```bash
IDVS_WORKFLOW_ID=
IDVS_WEBHOOK_SECRET=
IDVS_MONTHLY_SESSION_LIMIT=500
IDVS_SESSION_TIMEOUT_SECONDS=10
IDVS_DECISION_POLL_SECONDS=90
IDVS_TOKEN_EXTENSION_MINUTES=10
```

- [ ] **Step 3: Add the rate limit**

In `limits.py`, after `HANDOVER_PUBLIC`:

```python
# Starting a verification is the only public route that can spend money, so it gets the
# tightest budget in this file. A legitimate handover starts at most one session, and
# retries after a failed attempt are the only reason this is above 1.
IDVS_VERIFY = RateLimit(max_requests=5, window_seconds=_ONE_MINUTE, name="idvs_verify")
```

- [ ] **Step 4: Verify settings load**

```bash
cd backend && python -c "from app.core.config import settings; print(settings.IDVS_MONTHLY_SESSION_LIMIT, settings.IDVS_TOKEN_EXTENSION_MINUTES)"
```

Expected: `500 10`

- [ ] **Step 5: Stage**

```bash
git add backend/app/core/config.py backend/app/core/limits.py backend/.env.example
```

Suggested message: `feat(core): add IDVS configuration and verify rate limit`

---

## Task 5: Vendor client — types, Protocol and mock

**Files:**
- Create: `backend/app/integrations/idvs.py`
- Test: `backend/tests/unit/test_idvs_client.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_idvs_client.py`:

```python
"""MockIdvsClient behaviour. No network, no Redis — a dict-backed store is injected."""

from typing import Any, Optional

import pytest

from app.integrations.idvs import (
    IdvsDecisionStatus,
    MockIdvsClient,
)


class FakeStore:
    """Dict-backed MockStateStore, so these tests need no Redis."""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    async def get_json(self, key: str) -> Optional[dict[str, Any]]:
        return self.data.get(key)

    async def get_many_json(self, keys: list[str]) -> list[Optional[dict[str, Any]]]:
        return [self.data.get(k) for k in keys]

    async def set_json(self, key: str, value: dict[str, Any]) -> None:
        self.data[key] = value

    async def flush(self) -> int:
        count = len(self.data)
        self.data.clear()
        return count


async def test_create_session_returns_a_distinct_session_id_and_url():
    client = MockIdvsClient(store=FakeStore())

    first = await client.create_session(reference="handover-1")
    second = await client.create_session(reference="handover-2")

    assert first.session_id != second.session_id
    assert first.session_id in first.session_url


async def test_decision_defaults_to_approved_for_an_unstaged_session():
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1")

    decision = await client.get_decision(session.session_id)

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.session_id == session.session_id


async def test_staged_decline_is_returned_for_that_session_only():
    store = FakeStore()
    client = MockIdvsClient(store=store)
    declined = await client.create_session(reference="handover-1")
    approved = await client.create_session(reference="handover-2")

    await client.stage_decision(
        declined.session_id, status=IdvsDecisionStatus.DECLINED,
    )

    assert (await client.get_decision(declined.session_id)).status is IdvsDecisionStatus.DECLINED
    assert (await client.get_decision(approved.session_id)).status is IdvsDecisionStatus.APPROVED


async def test_staged_extracted_identity_is_returned():
    client = MockIdvsClient(store=FakeStore())
    session = await client.create_session(reference="handover-1")

    await client.stage_decision(
        session.session_id,
        status=IdvsDecisionStatus.APPROVED,
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    )
    decision = await client.get_decision(session.session_id)

    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


async def test_staging_is_refused_when_mock_mode_is_off(monkeypatch: pytest.MonkeyPatch):
    from app.core.config import settings
    from app.integrations.idvs import IdvsUnsupportedError

    monkeypatch.setattr(settings, "IDVS_USE_MOCK", False)
    client = MockIdvsClient(store=FakeStore())

    with pytest.raises(IdvsUnsupportedError):
        await client.stage_decision("any-session", status=IdvsDecisionStatus.DECLINED)
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && pytest tests/unit/test_idvs_client.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.integrations.idvs'`

- [ ] **Step 3: Write the module**

Create `backend/app/integrations/idvs.py`:

```python
"""Didit identity-verification client — document and live-face checks on a receiver.

╔══════════════════════════════════════════════════════════════════════════════╗
║  THE RESPONSE SHAPE IN THIS MODULE IS ASSUMED FROM PUBLIC DOCUMENTATION ONLY. ║
║  NO ACCOUNT HAS BEEN PROVISIONED AND NO RESPONSE HAS BEEN OBSERVED.           ║
╚══════════════════════════════════════════════════════════════════════════════╝

Same posture as pulsit.py, for the same reason: the integration is built now behind
IDVS_USE_MOCK and must not wait on a commercial conversation. Every guess is quarantined
in exactly two places:

    _parse_decision()        how one decision object is read
    the _DIDIT_* constants   paths, headers and field names

`IdvsDecision` — what callers actually consume — is ours, not Didit's, and is designed
not to move. Raw vendor JSON never leaves this module.

Assumption inventory, so a reviewer can audit the guess rather than discover it:

  * Sessions are created by POST to /v3/session/ with an x-api-key header.
  * The response carries session_id and session_url (Didit's documented field names).
  * Decisions are read by GET /v3/session/{id}/decision/.
  * Status is a string among Not Started / In Progress / Approved / Declined /
    In Review / Abandoned / Expired.
  * Extracted document fields live under a nested object; the exact path is the
    single most likely thing to change when a real response is first seen.

Layering: integrations -> config, mock_state. Never imports from api/ or orchestration/.

Scope: this module answers "start a check" and "what did the check say". It does not
decide a tier, does not write to the database, and raises no exception on a DECLINED
decision — a decline is a result, not an error, and orchestration owns what it means.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Optional, Protocol

import httpx

from app.core.config import settings
from app.integrations.mock_state import MockStateStore, build_key, get_mock_state_store

logger = logging.getLogger(__name__)

_IDVS_KEY_KIND = "idvs"
_PROVIDER_DIDIT = "didit"

# --- The quarantined guesses -------------------------------------------------
_DIDIT_SESSION_PATH = "/v3/session/"
_DIDIT_DECISION_PATH = "/v3/session/{session_id}/decision/"
_DIDIT_API_KEY_HEADER = "x-api-key"
_DIDIT_FIELD_SESSION_ID = "session_id"
_DIDIT_FIELD_SESSION_URL = "session_url"
_DIDIT_FIELD_STATUS = "status"
_DIDIT_FIELD_DECISION = "decision"
_DIDIT_FIELD_SURNAME = "surname"
_DIDIT_FIELD_ID_NUMBER = "document_number"
# -----------------------------------------------------------------------------


class IdvsError(Exception):
    """The vendor could not be reached or answered unusably."""


class IdvsUnsupportedError(IdvsError):
    """A mock-only operation was attempted while IDVS_USE_MOCK is false."""


class IdvsDecisionStatus(str, Enum):
    """Didit's session vocabulary, not ours.

    Deliberately NOT ReceiverVerificationStatus. That enum is what we store and means
    what WE concluded; this is what the vendor said. Collapsing them would bury the
    mapping — which is a judgement call orchestration owns — inside a parser.
    """

    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    APPROVED    = "approved"
    DECLINED    = "declined"
    IN_REVIEW   = "in_review"
    ABANDONED   = "abandoned"
    EXPIRED     = "expired"

    @classmethod
    def from_vendor(cls, raw: str) -> "IdvsDecisionStatus":
        """Map a vendor status string, defaulting unknown values to IN_PROGRESS.

        Unknown rather than raising: a vendor adding a status we have not seen must not
        turn every handover into a 500. IN_PROGRESS is the safe default because it is
        non-terminal — the sweeper will age it out rather than a trip recording a verdict
        the vendor never gave.
        """
        normalised = raw.strip().lower().replace(" ", "_").replace("-", "_")
        try:
            return cls(normalised)
        except ValueError:
            logger.warning("Unrecognised IDVS session status from vendor: %r", raw)
            return cls.IN_PROGRESS

    @property
    def is_terminal(self) -> bool:
        return self in {
            IdvsDecisionStatus.APPROVED,
            IdvsDecisionStatus.DECLINED,
            IdvsDecisionStatus.ABANDONED,
            IdvsDecisionStatus.EXPIRED,
        }


@dataclass(frozen=True)
class IdvsSession:
    """A started verification. `session_url` is where the receiver's browser goes."""

    session_id: str
    session_url: str


@dataclass(frozen=True)
class IdvsDecision:
    """What the vendor concluded about one session.

    `extracted_surname` and `extracted_id_number` are None whenever the vendor returned
    no document data — an abandoned session, or a workflow that captured no document.
    Callers must treat None as "nothing to compare", never as "did not match".
    """

    session_id: str
    status: IdvsDecisionStatus
    extracted_surname: Optional[str] = None
    extracted_id_number: Optional[str] = None
    decided_at: Optional[datetime] = None


class IdvsClient(Protocol):
    """A Protocol rather than a base class, matching PulsitClient and ScanFeed: it lets a
    test pass a stub without inheriting anything.
    """

    async def create_session(self, *, reference: str) -> IdvsSession:
        """Start a verification. `reference` is our own opaque handle, echoed back by the
        vendor so a webhook can be tied to a handover without trusting the browser.
        """
        ...

    async def get_decision(self, session_id: str) -> IdvsDecision:
        """The authoritative result for a session. Never derived from anything a client
        sent us — this call, made server-side with our API key, IS the authority.
        """
        ...


class MockIdvsClient:
    """Redis-backed stub — no network. IDVS_USE_MOCK=True selects it.

    Redis rather than a module-level dict for the reason mock_state.py exists: the API
    and the Celery worker are separate processes, so a decision staged in one would be
    invisible to the other.

    An unstaged session returns APPROVED. That default is chosen so the ordinary demo
    path — scan, verify, confirm — works with no staging at all, and a reviewer has to
    deliberately stage a failure to see one.
    """

    def __init__(self, store: Optional[MockStateStore] = None) -> None:
        self._store = store if store is not None else get_mock_state_store()

    def _key(self, session_id: str) -> str:
        return build_key(_IDVS_KEY_KIND, session_id)

    def _require_mock_mode(self) -> None:
        """Guard every staging call. Mirrors MockPulsitClient.stage_position."""
        if not settings.IDVS_USE_MOCK:
            raise IdvsUnsupportedError(
                "Cannot stage an IDVS decision while IDVS_USE_MOCK is false"
            )

    async def create_session(self, *, reference: str) -> IdvsSession:
        session_id = f"mock-{uuid.uuid4().hex}"
        await self._store.set_json(
            self._key(session_id),
            {"reference": reference, "created_at": datetime.now(UTC).isoformat()},
        )
        return IdvsSession(
            session_id=session_id,
            # Points at our own receiver app rather than a vendor domain: in mock mode
            # there is no hosted flow to visit, and a dead external link would make a
            # demo look broken for a reason that has nothing to do with the feature.
            session_url=f"{settings.HANDOVER_RECEIVER_BASE_URL.rstrip('/')}/mock-idvs/{session_id}",
        )

    async def stage_decision(
        self,
        session_id: str,
        *,
        status: IdvsDecisionStatus,
        extracted_surname: Optional[str] = None,
        extracted_id_number: Optional[str] = None,
    ) -> None:
        """Stage what the vendor will 'say' about a session. Dev panel / tests only."""
        self._require_mock_mode()
        existing = await self._store.get_json(self._key(session_id)) or {}
        await self._store.set_json(
            self._key(session_id),
            {
                **existing,
                "status": status.value,
                "extracted_surname": extracted_surname,
                "extracted_id_number": extracted_id_number,
            },
        )

    async def get_decision(self, session_id: str) -> IdvsDecision:
        staged: dict[str, Any] = await self._store.get_json(self._key(session_id)) or {}
        raw_status = staged.get("status")
        return IdvsDecision(
            session_id=session_id,
            status=(
                IdvsDecisionStatus(raw_status) if raw_status else IdvsDecisionStatus.APPROVED
            ),
            extracted_surname=staged.get("extracted_surname"),
            extracted_id_number=staged.get("extracted_id_number"),
            decided_at=datetime.now(UTC),
        )
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && pytest tests/unit/test_idvs_client.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Stage**

```bash
git add backend/app/integrations/idvs.py backend/tests/unit/test_idvs_client.py
```

Suggested message: `feat(integrations): add IDVS client protocol and Didit mock`

---

## Task 6: Vendor client — HTTP implementation and factory

**Files:**
- Modify: `backend/app/integrations/idvs.py`
- Modify: `backend/tests/unit/test_idvs_client.py`

- [ ] **Step 1: Write the failing parser test**

Add `_parse_decision` to the EXISTING `from app.integrations.idvs import (...)` block at
the top of `backend/tests/unit/test_idvs_client.py` — not a fresh import mid-file, which
trips ruff E402. Then append these tests:

```python
def test_parse_decision_reads_status_and_extracted_fields():
    payload = {
        "session_id": "abc123",
        "status": "Approved",
        "decision": {"surname": "Nkosi", "document_number": "9202204720082"},
    }

    decision = _parse_decision(payload, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.APPROVED
    assert decision.extracted_surname == "Nkosi"
    assert decision.extracted_id_number == "9202204720082"


def test_parse_decision_tolerates_a_missing_decision_block():
    decision = _parse_decision({"status": "Abandoned"}, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.ABANDONED
    assert decision.extracted_surname is None
    assert decision.extracted_id_number is None
    assert decision.session_id == "abc123"


def test_parse_decision_maps_an_unknown_status_to_in_progress():
    decision = _parse_decision({"status": "Teleported"}, fallback_session_id="abc123")

    assert decision.status is IdvsDecisionStatus.IN_PROGRESS
    assert not decision.status.is_terminal
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend && pytest tests/unit/test_idvs_client.py -k parse_decision -v
```

Expected: FAIL — `ImportError: cannot import name '_parse_decision'`

- [ ] **Step 3: Add the parser, HTTP client and factory**

Append to `backend/app/integrations/idvs.py`:

```python
def _parse_decision(payload: dict[str, Any], *, fallback_session_id: str) -> IdvsDecision:
    """Read one vendor decision object.

    THE quarantine point. When a real Didit response is first observed, this function and
    the _DIDIT_* constants above are the only things that should need to change — every
    caller consumes IdvsDecision, which is ours.

    Tolerant by design: a missing decision block yields None extracted fields rather than
    raising, because an abandoned or in-progress session legitimately has none, and a
    parser that raises on the ordinary case would turn a normal outcome into a 500.
    """
    raw_status = payload.get(_DIDIT_FIELD_STATUS)
    decision_block = payload.get(_DIDIT_FIELD_DECISION) or {}
    if not isinstance(decision_block, dict):
        logger.warning("IDVS decision block was not an object: %r", type(decision_block))
        decision_block = {}

    return IdvsDecision(
        session_id=str(payload.get(_DIDIT_FIELD_SESSION_ID) or fallback_session_id),
        status=(
            IdvsDecisionStatus.from_vendor(str(raw_status))
            if raw_status is not None
            else IdvsDecisionStatus.IN_PROGRESS
        ),
        extracted_surname=decision_block.get(_DIDIT_FIELD_SURNAME) or None,
        extracted_id_number=decision_block.get(_DIDIT_FIELD_ID_NUMBER) or None,
        decided_at=datetime.now(UTC),
    )


class DiditIdvsClient:
    """Live Didit client. IDVS_USE_MOCK=False selects it.

    One short-lived httpx client per call rather than a module-level pool, for the reason
    RedisMockStateStore gives: a pool binds to whichever event loop first touched it,
    which breaks under Celery's asyncio.run() per task and pytest's function-scoped loops.
    """

    def _require_configuration(self) -> None:
        """A misconfiguration must be loud here, not a confusing failure three layers down."""
        if not settings.IDVS_API_URL or not settings.IDVS_API_KEY:
            raise IdvsError(
                "IDVS_USE_MOCK is false but IDVS_API_URL or IDVS_API_KEY is unset."
            )

    @property
    def _headers(self) -> dict[str, str]:
        return {_DIDIT_API_KEY_HEADER: settings.IDVS_API_KEY, "Accept": "application/json"}

    async def create_session(self, *, reference: str) -> IdvsSession:
        self._require_configuration()
        url = settings.IDVS_API_URL.rstrip("/") + _DIDIT_SESSION_PATH
        body = {
            "workflow_id": settings.IDVS_WORKFLOW_ID,
            # Our own handle, echoed back on the webhook. It is how a vendor callback is
            # tied to a handover without the browser ever naming a session.
            "vendor_data": reference,
        }

        try:
            async with httpx.AsyncClient(timeout=settings.IDVS_SESSION_TIMEOUT_SECONDS) as http:
                response = await http.post(url, json=body, headers=self._headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Logged and re-raised, never swallowed: orchestration degrades the tier on
            # IdvsError, and it can only do that if it is told.
            logger.exception("IDVS session creation failed for reference=%s", reference)
            raise IdvsError("Could not create an IDVS session.") from exc

        session_id = payload.get(_DIDIT_FIELD_SESSION_ID)
        session_url = payload.get(_DIDIT_FIELD_SESSION_URL)
        if not session_id or not session_url:
            raise IdvsError("IDVS session response was missing session_id or session_url.")

        return IdvsSession(session_id=str(session_id), session_url=str(session_url))

    async def get_decision(self, session_id: str) -> IdvsDecision:
        self._require_configuration()
        path = _DIDIT_DECISION_PATH.format(session_id=session_id)
        url = settings.IDVS_API_URL.rstrip("/") + path

        try:
            async with httpx.AsyncClient(timeout=settings.IDVS_SESSION_TIMEOUT_SECONDS) as http:
                response = await http.get(url, headers=self._headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.exception("IDVS decision fetch failed for session=%s", session_id)
            raise IdvsError("Could not fetch the IDVS decision.") from exc

        return _parse_decision(payload, fallback_session_id=session_id)


def get_idvs_client() -> IdvsClient:
    """Select the mock or the live client. Mirrors get_pulsit_client()'s factory shape.

    The day credentials arrive, flipping IDVS_USE_MOCK to false is the entire change.
    """
    if settings.IDVS_USE_MOCK:
        return MockIdvsClient()
    return DiditIdvsClient()
```

- [ ] **Step 4: Run the full unit file**

```bash
cd backend && pytest tests/unit/test_idvs_client.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Confirm layering was not violated**

```bash
cd backend && grep -nE "from app\.(api|orchestration|db)" app/integrations/idvs.py || echo "layering clean"
```

Expected: `layering clean`

- [ ] **Step 6: Stage**

```bash
git add backend/app/integrations/idvs.py backend/tests/unit/test_idvs_client.py
```

Suggested message: `feat(integrations): add Didit HTTP client and factory`

---

## Task 7: Identity cross-check

**Files:**
- Create: `backend/app/orchestration/receiver_verification_service.py`
- Test: `backend/tests/unit/test_receiver_identity_match.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_receiver_identity_match.py`:

```python
"""The substitution defence: does the vendor's extracted identity agree with what the
receiver typed? A single-use session link stops replay, never a confederate completing
the flow with their own genuine document."""

from app.orchestration.receiver_verification_service import identity_matches


def test_matching_surname_and_id_number_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    ) is True


def test_comparison_ignores_case_whitespace_and_diacritics():
    assert identity_matches(
        typed_name="  josé  MÜLLER ",
        typed_id_number=" 9202204720082 ",
        extracted_surname="Muller",
        extracted_id_number="9202-204-720082",
    ) is True


def test_a_different_id_number_does_not_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="8801015800085",
    ) is False


def test_a_different_surname_does_not_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Dlamini",
        extracted_id_number="9202204720082",
    ) is False


def test_surname_matches_any_token_of_the_typed_name():
    """Given-name ordering and initials vary too much between a document and self-entry
    to carry a signal, so only the surname is required to appear."""
    assert identity_matches(
        typed_name="Nkosi, Thandi Grace",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    ) is True


def test_no_extracted_data_is_unknown_not_a_mismatch():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname=None,
        extracted_id_number=None,
    ) is None
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend && pytest tests/unit/test_receiver_identity_match.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.orchestration.receiver_verification_service'`

- [ ] **Step 3: Write the module**

Create `backend/app/orchestration/receiver_verification_service.py`:

```python
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
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && pytest tests/unit/test_receiver_identity_match.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Stage**

```bash
git add backend/app/orchestration/receiver_verification_service.py backend/tests/unit/test_receiver_identity_match.py
```

Suggested message: `feat(orchestration): add receiver identity cross-check`

---

## Task 8: Quota ledger integration test

**Files:**
- Create: `backend/tests/integration/test_idvs_quota_ledger.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_idvs_quota_ledger.py`:

```python
"""The free-tier quota is a spending control, so it is tested against a real database.

The team's decision is a hard stop: at the ceiling we stop calling the vendor and degrade
the handover's evidence tier. Session 501 must never be billed.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.models.receiver_verification import IdvsQuotaLedger
from app.orchestration.receiver_verification_service import (
    PROVIDER_DIDIT,
    consume_quota_slot,
)


async def test_first_call_creates_the_period_row_and_consumes_one(db_session):
    granted = await consume_quota_slot(db_session)

    assert granted is True
    row = (
        await db_session.execute(
            select(IdvsQuotaLedger).where(IdvsQuotaLedger.provider == PROVIDER_DIDIT)
        )
    ).scalar_one()
    assert row.sessions_used == 1
    assert row.period == datetime.now(UTC).strftime("%Y-%m")


async def test_consumption_is_refused_at_the_ceiling(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 2)

    first = await consume_quota_slot(db_session)
    second = await consume_quota_slot(db_session)
    third = await consume_quota_slot(db_session)

    assert (first, second, third) == (True, True, False)


async def test_a_refused_claim_does_not_increment_the_counter(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 1)
    await consume_quota_slot(db_session)

    await consume_quota_slot(db_session)

    row = (
        await db_session.execute(
            select(IdvsQuotaLedger).where(IdvsQuotaLedger.provider == PROVIDER_DIDIT)
        )
    ).scalar_one()
    assert row.sessions_used == 1, "a refused claim must not spend a slot"


async def test_providers_are_metered_independently(
    db_session, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 1)

    await consume_quota_slot(db_session, provider=PROVIDER_DIDIT)
    other = await consume_quota_slot(db_session, provider="other-vendor")

    assert other is True, "one provider's ceiling must not close another's"
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd backend && pytest tests/integration/test_idvs_quota_ledger.py -v
```

Expected: FAIL — the table does not exist unless Task 3's migration has been applied.
If that is the failure, run `alembic upgrade head` and re-run.

- [ ] **Step 3: Run until green**

```bash
cd backend && pytest tests/integration/test_idvs_quota_ledger.py -v
```

Expected: 4 passed. No implementation change should be needed — Task 7 already wrote it.
If a test fails, the bug is in `consume_quota_slot`, not in the test.

- [ ] **Step 4: Stage**

```bash
git add backend/tests/integration/test_idvs_quota_ledger.py
```

Suggested message: `test(orchestration): cover IDVS quota ledger hard stop`

---

## Task 9: Full suite and handoff

- [ ] **Step 1: Run the whole backend suite**

```bash
cd backend && pytest
```

Expected: green. The suite was clean as of the last full run, so **any** failure here is
either yours or a genuine regression — do not accept a "pre-existing failure" without
checking `git stash` against it.

- [ ] **Step 2: Confirm no network calls were made**

```bash
cd backend && grep -n "IDVS_USE_MOCK" app/core/config.py
```

Expected: default `True`. No test in this stage may require credentials.

- [ ] **Step 3: Review what is staged**

```bash
git diff --staged --stat
```

- [ ] **Step 4: Report TASK COMPLETE** using the `CLAUDE.md` template. It **must** flag:
  - Shared files: `core/config.py`, `core/limits.py`, `db/models/__init__.py`,
    `db/models/enums.py`, `.env.example`
  - Migration: `2026_09_<dd>_tim_add_receiver_verification.py`
  - New `.env` keys: the six `IDVS_*` settings from Task 4
  - That nothing is committed — the developer commits.

---

## Stage 1 done when

- [ ] `pytest` green from `backend/`
- [ ] `alembic upgrade head` → `downgrade -1` → `upgrade head` all clean
- [ ] `integrations/idvs.py` imports nothing from `api/`, `orchestration/` or `db/`
- [ ] Every test passes with `IDVS_USE_MOCK=true` and no credentials set
- [ ] Nothing committed; everything staged

## Not in this stage

Consent route, verify/resolve routes, webhook + HMAC, tier resolution, exception raising,
capability-token extension, the abandonment sweeper, and the receiver UI. Those are
Stage 2 and Stage 3, and each gets its own plan. Deliberately: this stage has no HTTP
surface, which is what makes it reviewable on its own.
