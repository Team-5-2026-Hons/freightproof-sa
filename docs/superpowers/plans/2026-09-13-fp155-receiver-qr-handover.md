# FP-155 Receiver QR Handover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the proof-of-delivery signature off the driver's phone and onto the receiver's own phone, reached by scanning a rotating QR code displayed on the driver's device.

**Architecture:** The driver's confirmation phase gains a new step, `2-receiver-handover`, which displays a QR that re-issues itself every 20 seconds from the FP-236 capability-token service. The QR encodes a URL to a new, tiny, unauthenticated Next.js app (`frontend/receiver/`). The receiver scans it with their ordinary camera, sees what they are confirming, enters their name and ID, swipes to sign, and their browser renders the attestation PNG and POSTs it with their own GPS fix. The server redeems the token atomically, stores the PNG as a trip artifact with **no** driver attribution, and writes a `HandoverConfirmation` row. The driver's step polls until that row exists, writes the returned `pod_signature_artifact_id` into its local draft, and the **existing, unchanged** `ConfirmationCompleteRequest` submits exactly as it does today.

**The property that makes this worth building** (from `docs/iteration2-feedback-response-2026-08-25.md` §7): not identity registration — *that the confirmation is produced somewhere the driver cannot produce it*. This is tier 1 plus an independent GPS fix. It makes fraud **provable, not impossible**; a driver with a second handset still defeats it. Say that out loud at examination rather than overclaiming.

**Tech Stack:** FastAPI 0.115+, SQLAlchemy 2.0 async, Pydantic v2, Alembic, pytest; Next.js 15 App Router, React 19, TypeScript 5.5+, Tailwind 3.4+, vitest; `qrcode` (npm) for QR rendering.

---

## Why the backend confirmation contract does not change

`ConfirmationCompleteRequest.pod_signature_artifact_id` stays a required `UUID`. `compute_confirmation_canonical_payload` is **not touched**. This is deliberate and load-bearing:

`verification_service._reconstruct_phase_event_payload` rebuilds the anchored canonical payload from stored columns on every verify. Adding, removing, or renaming a key there breaks hash verification on **every historical trip**. The handover changes *who produces* the signature artifact and *where*, not *what the confirmation phase submits*. The driver still sends a `pod_signature_artifact_id`; it is simply an artifact somebody else created.

## Threat notes carried into the design

| Concern | How this plan handles it |
|---|---|
| Token guessing | Unchanged from FP-236: 256 bits from `secrets.token_urlsafe(32)`, SHA-256 at rest, indexed equality lookup (no byte-wise compare, so no timing channel). |
| Public page as an oracle | Every failure on both public routes returns an identical `404` with one fixed detail string. EXPIRED / UNKNOWN / ALREADY_REDEEMED / WRONG_TRIP / WRONG_STOP are distinguished **only** in `handover_token_attempts`. |
| Sibling tokens in a rotation | On successful redemption, every other unredeemed token for the same `phase_event_id` is expired in the same transaction. A late scan of a photographed older frame gets the same generic 404. |
| Receiver PII | Name and ID number are rendered **into the PNG** and stored in Supabase Storage (`af-south-1`). They are **not** columns on `handover_confirmations`, not on any phase row, not in any canonical payload, and never reach Hedera. Identical to the POPIA reasoning already written on `ConfirmationEvidence.recipientName`. |
| Same-device fraud (FP-240) | Recorded, never gated — the seal-mismatch precedent. `receiver_ip`, `receiver_user_agent` and `bearer_token_present` go on the row. A camera scan never carries a bearer token; a driver curling his own QR from the app's session does. |
| Unauthenticated upload abuse | The token **is** the authorisation, and it is single-use. Size-capped server-side before decode. Rate-limited per IP. |

---

## File Structure

### Backend — create

| File | Responsibility |
|---|---|
| `backend/app/db/models/handover.py` *(modify)* | Add `HandoverConfirmation`. |
| `backend/app/schemas/handover.py` | Pydantic v2 request/response models for all four routes. |
| `backend/app/api/v1/endpoints/handover.py` | Two routers: driver-scoped (`/trips/{id}/phases/{id}/handover*`) and public (`/handover/{token}*`). |
| `backend/migrations/versions/2026_09_13_tim_add_handover_confirmations.py` | The new table. |
| `backend/tests/unit/test_handover_rotation.py` | Sibling expiry + rotation service logic. |
| `backend/tests/integration/test_handover_endpoints.py` | All four routes: success, 401, 404, 422, identical-rejection. |

### Backend — modify

| File | Change |
|---|---|
| `backend/app/core/config.py` | `HANDOVER_ROTATION_SECONDS`, `HANDOVER_RECEIVER_BASE_URL`. **SHARED FILE.** |
| `backend/.env.example` | Same two keys, empty/defaulted. |
| `backend/app/core/limits.py` | `HANDOVER_ISSUE`, `HANDOVER_PUBLIC`. |
| `backend/app/core/phase_meta.py` | `2-pod-signature` → `2-receiver-handover`. |
| `backend/app/orchestration/handover_service.py` | `rotate_capability_token`, `_expire_siblings`, `load_handover_confirmation`, `record_handover_confirmation`. |
| `backend/app/orchestration/artifact_service.py` | `create_receiver_artifact` — no driver attribution. |
| `backend/app/db/models/__init__.py` | Register `HandoverConfirmation`. **SHARED FILE.** |
| `backend/app/main.py` | Register both routers. **SHARED FILE.** |

### Frontend shared — modify

| File | Change |
|---|---|
| `frontend/shared/lib/constants/phase-meta.ts` | Slug + name. **SHARED FILE — must land in the same commit as `phase_meta.py`.** |
| `frontend/shared/lib/utils/render-attestation.ts` *(new)* | Moved from `driver-pwa/lib/utils/` so the receiver app can use it. |
| `frontend/shared/lib/utils/sa-id.ts` *(new)* | Moved for the same reason. |
| `frontend/shared/lib/types/position.ts` *(new)* | `PositionFix` — the renderer's position type, no longer named for the driver. |
| `frontend/shared/lib/constants/attestation-colours.ts` *(new)* | `ATTESTATION_CANVAS_COLOURS`, moved out of `driver-pwa/lib/tokens.ts`. |

### Driver PWA

| File | Change |
|---|---|
| `lib/api/handover.ts` *(new)* | `issueHandoverToken`, `fetchHandoverStatus`. |
| `lib/hooks/useRotatingHandover.ts` *(new)* | Owns the rotation timer + the status poll. |
| `components/ui/QrCode.tsx` *(new)* | Renders a payload to a canvas. |
| `components/phase/steps/confirmation/ReceiverHandover.tsx` *(new)* | The step. |
| `components/phase/steps/confirmation/PodSignature.tsx` *(delete)* | Replaced. |
| `components/phase/DigitalSignature.tsx` *(delete)* | Moves to the receiver app. |
| `components/phase/steps/registry.ts` | Swap the slug + component. |
| `lib/types/evidence-draft.ts` | `ConfirmationEvidence` field changes. |
| `lib/utils/render-attestation.ts`, `lib/utils/sa-id.ts` *(delete)* | Re-exported from `@shared`. |
| `package.json` | `+ qrcode`, `+ @types/qrcode`. **SHARED FILE.** |

### Receiver app — all new

`frontend/receiver/` — `package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `app/layout.tsx`, `app/globals.css`, `app/h/[token]/page.tsx`, `app/h/[token]/HandoverPageClient.tsx`, `lib/api.ts`, `components/Swipe.tsx`, `vitest.config.ts`.

---

## Stage 1 — Backend foundation

### Task 1: Config and rate-limit budgets

**Files:**
- Modify: `backend/app/core/config.py` (after `HANDOVER_TOKEN_EXPIRY_MINUTES`, ~line 185)
- Modify: `backend/.env.example` (after `HANDOVER_TOKEN_EXPIRY_MINUTES`)
- Modify: `backend/app/core/limits.py` (append)

- [ ] **Step 1: Add the two settings**

In `config.py`, directly beneath `HANDOVER_TOKEN_EXPIRY_MINUTES`:

```python
    # How often the driver's screen replaces the displayed QR with a freshly issued
    # token. Not a security boundary on its own — HANDOVER_TOKEN_EXPIRY_MINUTES is —
    # but it bounds how long a photograph of the driver's screen stays redeemable,
    # which is the attack the rotation exists for. Short enough that a photo taken
    # across a warehouse is dead before it is useful; long enough that a receiver
    # fumbling their camera app does not watch the code change under them.
    HANDOVER_ROTATION_SECONDS: int = 20

    # Origin of the public receiver app (frontend/receiver), used to build the URL
    # encoded into the QR. Must be reachable from a receiver's mobile data — never
    # localhost in a deployed environment, or every scan dead-ends on their phone.
    # No trailing slash; build_scan_url asserts this rather than silently producing
    # a double-slashed URL that some QR readers mangle.
    HANDOVER_RECEIVER_BASE_URL: str = "http://localhost:3002"
```

- [ ] **Step 2: Add the same keys to `.env.example`**

```bash
# HANDOVER_ROTATION_SECONDS: how often the driver's QR re-issues itself (FP-237).
HANDOVER_ROTATION_SECONDS=20
# HANDOVER_RECEIVER_BASE_URL: public origin of the receiver scan app (FP-239). Must be
# reachable from a receiver's mobile data. No trailing slash.
HANDOVER_RECEIVER_BASE_URL=http://localhost:3002
```

- [ ] **Step 3: Add the budgets**

Append to `backend/app/core/limits.py`:

```python
# Rotating-QR issuance (FP-237). One driver standing on the handover step issues one
# token per HANDOVER_ROTATION_SECONDS — at the default 20s that is 3/minute, and the
# grant window is 10 minutes, so a legitimate handover spends ~30. Sized to absorb a
# reconnect storm (the step re-issues on regaining focus) without letting a wedged
# client mint tokens in a loop.
HANDOVER_ISSUE = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="handover_issue")

# The two PUBLIC handover routes, counted per IP because a receiver has no token to
# count against. Tighter than anything else here: these are the only unauthenticated
# write-capable routes in the API, and the confirm path accepts an image. A real
# receiver loads the page once and confirms once.
HANDOVER_PUBLIC = RateLimit(max_requests=20, window_seconds=_ONE_MINUTE, name="handover_public")
```

- [ ] **Step 4: Verify config loads**

Run: `cd backend && python -c "from app.core.config import settings; print(settings.HANDOVER_ROTATION_SECONDS, settings.HANDOVER_RECEIVER_BASE_URL)"`
Expected: `20 http://localhost:3002`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/.env.example backend/app/core/limits.py
git commit -m "feat(api): handover rotation + receiver-origin config and rate budgets (FP-237)"
```

---

### Task 2: The `HandoverConfirmation` model

**Files:**
- Modify: `backend/app/db/models/handover.py` (append)
- Modify: `backend/app/db/models/__init__.py` — **SHARED FILE**

- [ ] **Step 1: Append the model**

```python
class HandoverConfirmation(Base):
    """What the receiver actually did, once a capability token was redeemed.

    One row per successful redemption — enforced by the unique constraint on
    `phase_event_id`, not merely by the token being single-use: the rotating series
    (FP-237) issues many tokens against one phase event, and this constraint is what
    makes "the confirmation happened once" true at the database rather than at the
    application's word.

    What is NOT here is as deliberate as what is. The receiver's name and ID number
    are rendered INTO the attestation PNG and live only in Supabase Storage
    (af-south-1), exactly as ConfirmationEvidence.recipientName documents for the
    driver-side flow this replaces. Putting them in columns here would move personal
    data into a row that phase reads and evidence exports join against, for no
    evidential gain — the PNG is what gets hashed and shown in a dispute.

    receiver_ip and receiver_user_agent are recorded as WEAK signals and nothing more.
    South African mobile networks are heavily CGNAT'd (see
    docs/iteration2-feedback-response-2026-08-25.md §7): thousands of subscribers share
    one address, and driver and receiver on the same warehouse wifi are identical. They
    are kept because a rejected or suspicious attempt is evidence in its own right, the
    same principle handover_token_attempts applies — never because they identify anyone.
    """

    __tablename__ = "handover_confirmations"
    __table_args__ = (
        UniqueConstraint("phase_event_id", name="uq_handover_confirmations_phase_event_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The redeemed grant this confirmation came through. Non-null: a confirmation with
    # no token did not come from a scan, and there is no other way to create one.
    token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("handover_capability_tokens.id"), nullable=False
    )
    phase_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phase_events.id"), nullable=False
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    # The attestation PNG the receiver's own browser rendered. This is the artifact the
    # driver's ConfirmationCompleteRequest then submits as pod_signature_artifact_id —
    # the whole point of the feature is that this id refers to something the driver's
    # device did not produce.
    signature_artifact_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_artifacts.id"), nullable=False
    )
    # The receiver's OWN position fix, from their own browser — the third independent
    # source on the most disputed moment in the trip, alongside the driver's phone and
    # Pulsit. Nullable because a browser may refuse or fail to produce one, and a
    # handover with no fix is still a handover; the absence is itself recorded.
    receiver_lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    receiver_accuracy_m: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    receiver_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    receiver_user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # FP-240. True when the confirming request carried an Authorization header at all.
    # An ordinary camera scan opens a fresh, tokenless browser context, so this is
    # normally False; True means the confirmation came from something already holding
    # one of our sessions — most plausibly the driver's own handset. Recorded as
    # evidence and never used as a gate, following the seal-mismatch precedent in
    # phase_service.py: record it, do not just refuse and forget it happened.
    bearer_token_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Server clock, never the client's — design point carried from the feedback
    # response: "Server timestamp only — never trust the client clock."
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] **Step 2: Extend the imports at the top of `handover.py`**

```python
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, UniqueConstraint
```

- [ ] **Step 3: Register it** — in `backend/app/db/models/__init__.py`, extend the existing handover import line to `HandoverCapabilityToken, HandoverConfirmation, HandoverTokenAttempt` and add `"HandoverConfirmation"` to `__all__`.

- [ ] **Step 4: Confirm it imports**

Run: `cd backend && python -c "from app.db.models import HandoverConfirmation; print(HandoverConfirmation.__tablename__)"`
Expected: `handover_confirmations`

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models/handover.py backend/app/db/models/__init__.py
git commit -m "feat(db): HandoverConfirmation model for redeemed receiver handovers (FP-239)"
```

---

### Task 3: Migration

**Files:**
- Create: `backend/migrations/versions/2026_09_13_tim_add_handover_confirmations.py`

- [ ] **Step 1: Check the chain before generating anything**

Run: `git fetch origin && cd backend && alembic heads`
Expected: exactly one head. If more than one, **stop and coordinate** — do not fix the revision chain yourself (CLAUDE.md). Note the current head id; the plan below assumes `tom_trailer_vehicle_analytics`, which is `dev`'s head as of 2026-09-13. If `alembic heads` disagrees, use what it prints.

- [ ] **Step 2: Write the migration by hand**

Hand-written rather than `--autogenerate`, so the chain and the file name are under control with four devs on the branch.

```python
"""FP-239 — handover_confirmations: what the receiver did once a token was redeemed.

The unique constraint on phase_event_id is the real content of this migration. The
rotating series (FP-237) issues many capability tokens against one confirmation phase
event; exactly one of them may ever produce a confirmation, and that is enforced here
rather than trusted to the application, for the same reason FP-236 put the redemption
gate in a conditional UPDATE instead of in Python.

Revision ID: tim_handover_confirmations
Revises: tom_trailer_vehicle_analytics
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Keep revision ids under 32 characters — alembic_version.version_num is varchar(32).
revision = "tim_handover_confirm"
down_revision = "tom_trailer_vehicle_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "handover_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("token_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("handover_capability_tokens.id"), nullable=False),
        sa.Column("phase_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("phase_events.id"), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trips.id"), nullable=False),
        sa.Column("signature_artifact_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("evidence_artifacts.id"), nullable=False),
        sa.Column("receiver_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("receiver_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("receiver_accuracy_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("receiver_ip", sa.String(45), nullable=True),
        sa.Column("receiver_user_agent", sa.String(512), nullable=True),
        sa.Column("bearer_token_present", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_handover_confirmations_phase_event_id", "handover_confirmations", ["phase_event_id"],
    )
    # The driver's step polls this by trip while waiting for the receiver to scan, once
    # every few seconds for as long as the handover takes. Without this it is a
    # sequential scan on every poll.
    op.create_index("ix_handover_confirmations_trip_id", "handover_confirmations", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_handover_confirmations_trip_id", table_name="handover_confirmations")
    op.drop_constraint("uq_handover_confirmations_phase_event_id", "handover_confirmations", type_="unique")
    op.drop_table("handover_confirmations")
```

- [ ] **Step 3: Apply it, then prove the chain is linear**

Run: `cd backend && alembic upgrade head && alembic heads`
Expected: one head, `tim_handover_confirm`. CI never runs Alembic, so this local run is the only check that exists — do not skip it.

- [ ] **Step 4: Prove the downgrade works too**

Run: `cd backend && alembic downgrade -1 && alembic upgrade head`
Expected: both succeed with no error.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/versions/2026_09_13_tim_add_handover_confirmations.py
git commit -m "feat(db): migration for handover_confirmations (FP-239)"
```

---

### Task 4: Rotation, sibling expiry, and the confirmation record

**Files:**
- Modify: `backend/app/orchestration/handover_service.py`
- Test: `backend/tests/unit/test_handover_rotation.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_handover_rotation.py`. Reuse the `_seed` helper style from `test_handover_service.py` — import it rather than duplicating the body:

```python
"""FP-237 — the rotating series, and the one-confirmation-per-phase-event guarantee.

The series is many capability tokens against ONE phase event. What makes it a series
rather than a pile of independent grants is that redeeming any one of them kills the
rest, which is what this module exercises. The single-token branches live in
test_handover_service.py.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db.models.handover import HandoverCapabilityToken
from app.orchestration.handover_service import (
    expire_sibling_tokens,
    redeem_capability_token,
    rotate_capability_token,
)
from tests.unit.test_handover_service import _seed

# _seed returns plain ids, not ORM objects: {"trip_id", "stop_id", "other_stop_id",
# "other_trip_id", "phase_event_id"}. Unpacked into these three on every test below.


async def test_rotate_issues_a_new_token_each_call(db_session):
    s = await _seed(db_session, tag="rot1")

    first, _ = await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )
    second, _ = await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )

    assert first != second


async def test_rotate_expires_the_previous_token_in_the_series(db_session):
    s = await _seed(db_session, tag="rot2")

    stale, _ = await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )
    await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )

    result = await redeem_capability_token(
        db_session, trip_id=s["trip_id"], trip_stop_id=s["stop_id"], raw_token=stale,
    )

    assert result.success is False


async def test_the_newest_token_in_the_series_still_redeems(db_session):
    s = await _seed(db_session, tag="rot3")

    await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )
    current, _ = await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )

    result = await redeem_capability_token(
        db_session, trip_id=s["trip_id"], trip_stop_id=s["stop_id"], raw_token=current,
    )

    assert result.success is True


async def test_expire_siblings_leaves_the_named_token_alone(db_session):
    s = await _seed(db_session, tag="rot4")
    _, keep = await rotate_capability_token(
        db_session, phase_event_id=s["phase_event_id"],
        trip_id=s["trip_id"], trip_stop_id=s["stop_id"],
    )

    await expire_sibling_tokens(
        db_session, phase_event_id=s["phase_event_id"], keep_token_id=keep.id,
    )

    row = (
        await db_session.execute(
            select(HandoverCapabilityToken).where(HandoverCapabilityToken.id == keep.id)
        )
    ).scalar_one()
    assert row.expires_at > row.created_at
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && pytest tests/unit/test_handover_rotation.py -v`
Expected: FAIL — `ImportError: cannot import name 'rotate_capability_token'`

- [ ] **Step 3: Implement the three functions**

Append to `backend/app/orchestration/handover_service.py`:

```python
async def expire_sibling_tokens(
    db: AsyncSession,
    *,
    phase_event_id: uuid.UUID,
    keep_token_id: Optional[uuid.UUID] = None,
) -> None:
    """Retire every unredeemed token in a phase event's series except `keep_token_id`.

    Expiry, not deletion. A retired token still has to be able to explain itself: a
    receiver who scans a photographed older frame produces a redemption ATTEMPT, and
    that attempt is evidence (the ticket's DoD). Deleting the row would leave that
    attempt pointing at nothing, which is exactly the UNKNOWN case that means something
    entirely different — a token this system never issued.

    Expiring rather than flagging is also what keeps the public response honest with no
    extra work: redeem_capability_token's existing UPDATE already refuses on
    `expires_at > now()`, and classifies the refusal as EXPIRED, which FP-239 renders
    identically to every other failure.
    """
    now = datetime.now(UTC)
    conditions = [
        HandoverCapabilityToken.phase_event_id == phase_event_id,
        HandoverCapabilityToken.redeemed_at.is_(None),
        HandoverCapabilityToken.expires_at > now,
    ]
    if keep_token_id is not None:
        conditions.append(HandoverCapabilityToken.id != keep_token_id)

    await db.execute(
        update(HandoverCapabilityToken).where(*conditions).values(expires_at=now)
    )
    await db.flush()


async def rotate_capability_token(
    db: AsyncSession,
    *,
    phase_event_id: uuid.UUID,
    trip_id: uuid.UUID,
    trip_stop_id: uuid.UUID,
) -> tuple[str, HandoverCapabilityToken]:
    """Issue the next token in a phase event's series, retiring the one before it.

    This is what makes the driver's rotating QR a SERIES sharing one grant rather than
    a growing pile of live tokens: at most one token per confirmation is redeemable at
    any instant. Without the retirement, a ten-minute handover would leave thirty valid
    tokens behind it, and photographing the screen once would defeat the rotation
    entirely — which is the only thing the rotation exists to prevent.
    """
    raw_token, token = await issue_capability_token(
        db, phase_event_id=phase_event_id, trip_id=trip_id, trip_stop_id=trip_stop_id,
    )
    await expire_sibling_tokens(db, phase_event_id=phase_event_id, keep_token_id=token.id)
    return raw_token, token


async def load_handover_confirmation(
    db: AsyncSession, *, phase_event_id: uuid.UUID,
) -> Optional[HandoverConfirmation]:
    """The confirmation for a phase event, or None while the receiver has not scanned."""
    return (
        await db.execute(
            select(HandoverConfirmation).where(HandoverConfirmation.phase_event_id == phase_event_id)
        )
    ).scalar_one_or_none()


async def record_handover_confirmation(
    db: AsyncSession,
    *,
    token: HandoverCapabilityToken,
    signature_artifact_id: uuid.UUID,
    receiver_lat: Optional[Decimal],
    receiver_lng: Optional[Decimal],
    receiver_accuracy_m: Optional[Decimal],
    receiver_ip: Optional[str],
    receiver_user_agent: Optional[str],
    bearer_token_present: bool,
) -> HandoverConfirmation:
    """Write the confirmation row and retire the rest of the series.

    Called only after redeem_capability_token has already returned success, so the
    single-use gate has been passed at the database. The sibling retirement here is
    what closes the window the rotation opens: the redeemed token is dead by its own
    redeemed_at, and every other frame the driver's screen showed is dead by this call.
    """
    confirmation = HandoverConfirmation(
        id=uuid.uuid4(),
        token_id=token.id,
        phase_event_id=token.phase_event_id,
        trip_id=token.trip_id,
        signature_artifact_id=signature_artifact_id,
        receiver_lat=receiver_lat,
        receiver_lng=receiver_lng,
        receiver_accuracy_m=receiver_accuracy_m,
        receiver_ip=receiver_ip,
        # Truncated rather than rejected: a user agent longer than the column is a
        # curiosity worth keeping the front of, not a reason to refuse a delivery
        # confirmation the receiver has already performed.
        receiver_user_agent=(receiver_user_agent or "")[:512] or None,
        bearer_token_present=bearer_token_present,
    )
    db.add(confirmation)
    await db.flush()

    await expire_sibling_tokens(db, phase_event_id=token.phase_event_id, keep_token_id=None)
    return confirmation


def build_scan_url(raw_token: str) -> str:
    """The URL encoded into the QR the driver's screen displays.

    Built here rather than in the endpoint so the driver app never composes a URL out
    of a base and a secret itself — the token is the whole secret, and the one place
    that concatenation happens is the one place to audit it.
    """
    base = settings.HANDOVER_RECEIVER_BASE_URL.rstrip("/")
    return f"{base}/h/{raw_token}"
```

Extend the imports at the top of the file:

```python
from decimal import Decimal

from app.db.models.handover import (
    HandoverCapabilityToken,
    HandoverConfirmation,
    HandoverTokenAttempt,
)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && pytest tests/unit/test_handover_rotation.py tests/unit/test_handover_service.py -v`
Expected: all PASS. The existing FP-236 tests must still pass unchanged — `issue_capability_token` was not modified.

- [ ] **Step 5: Commit**

```bash
git add backend/app/orchestration/handover_service.py backend/tests/unit/test_handover_rotation.py
git commit -m "feat(orchestration): rotating token series and handover confirmation record (FP-237)"
```

---

### Task 5: Receiver-created artifacts

**Files:**
- Modify: `backend/app/orchestration/artifact_service.py`

- [ ] **Step 1: Add the function**

`create_artifact` raises `PermissionError` unless `captured_by_driver_id` is the trip's assigned driver. A receiver is not a driver and has no account, so it needs its own entry point rather than a nullable parameter threaded through the existing one — the driver check is the whole point of that function and must not become optional.

```python
async def create_receiver_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_lat: Decimal | None = None,
    captured_lng: Decimal | None = None,
) -> EvidenceArtifactRead:
    """Store an artifact produced by a receiver holding a redeemed capability token.

    Deliberately NOT create_artifact with a nullable driver id. That function's
    `trip.driver_id != captured_by_driver_id` check is its reason to exist, and making
    it skippable would put an `if caller_is_trusted` branch inside the one place that
    decides whether an upload belongs to its trip. The authorisation here is a
    different thing entirely — a single-use capability token the caller has already
    redeemed — and it belongs to the caller, not to this function.

    Both attribution columns are left NULL, which is the honest record: nobody with an
    account on this system captured this. The evidence that it came from the receiver
    is the HandoverConfirmation row that references it, not a column here pointing at a
    driver who was standing on the other side of the transaction.
    """
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.")

    verified_mime_type = resolve_mime_type(file_bytes, mime_type)

    trip = (await db.execute(select(Trip).where(Trip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))

    return await _persist_artifact(
        db,
        trip_id=trip_id,
        file_bytes=file_bytes,
        verified_mime_type=verified_mime_type,
        artifact_type=artifact_type,
        captured_at=captured_at,
        captured_by_driver_id=None,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
    )
```

- [ ] **Step 2: Extract the shared tail**

Read the body of `create_artifact` after its `PermissionError` check. Move everything from the `upload_evidence_file(...)` call to the `return EvidenceArtifactRead.model_validate(artifact)` into a new private `_persist_artifact`, and have `create_artifact` call it too. Do not duplicate the upload logic — one bucket path convention, one hash computation, one place.

```python
async def _persist_artifact(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    file_bytes: bytes,
    verified_mime_type: str,
    artifact_type: ArtifactType,
    captured_at: datetime,
    captured_by_driver_id: uuid.UUID | None,
    captured_lat: Decimal | None,
    captured_lng: Decimal | None,
) -> EvidenceArtifactRead:
    """Upload the bytes and write the row. Assumes the caller has already decided the
    upload is authorised — that decision differs per caller (assigned driver vs. redeemed
    capability token) and deliberately does not live here."""
    upload = await upload_evidence_file(
        trip_id=str(trip_id), file_bytes=file_bytes, mime_type=verified_mime_type,
    )

    artifact = EvidenceArtifact(
        id=uuid.uuid4(),
        trip_id=trip_id,
        artifact_type=artifact_type,
        s3_key=upload.s3_key,
        s3_bucket=upload.s3_bucket,
        file_hash=upload.file_hash,
        mime_type=verified_mime_type,
        captured_by_driver_id=captured_by_driver_id,
        captured_lat=captured_lat,
        captured_lng=captured_lng,
        captured_at=captured_at,
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    return EvidenceArtifactRead.model_validate(artifact)
```

`captured_by_user_id` is not set by either caller — `create_artifact` never set it, and a receiver has no user row. It stays NULL, which is what the column is for.

- [ ] **Step 3: Verify nothing regressed**

Run: `cd backend && pytest tests/ -k artifact -v`
Expected: all existing artifact tests PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/app/orchestration/artifact_service.py
git commit -m "refactor(storage): extract _persist_artifact, add unattributed receiver path (FP-239)"
```

---

### Task 6: Schemas

**Files:**
- Create: `backend/app/schemas/handover.py`
- Modify: `backend/app/schemas/__init__.py`

- [ ] **Step 1: Write the schemas**

```python
"""Wire shapes for the receiver QR handover (FP-155).

Split across two audiences with very different trust levels. HandoverTokenResponse and
HandoverStatusResponse are read by the DRIVER's authenticated app. HandoverScanResponse
and HandoverConfirmRequest are read and written by an ANONYMOUS browser, so everything
in them is either public-by-nature or supplied by the receiver about themselves.
"""

import base64
import binascii
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# A rendered attestation is a few tens of KB of PNG. The cap is on the DECODED bytes
# and exists so an anonymous caller cannot spend our Storage bill or our memory; the
# real file-size ceiling is still artifact_service.MAX_FILE_SIZE_BYTES, which this sits
# well under. Base64 inflates by 4/3, so the encoded field is bounded separately below
# to reject an oversized body before it is ever decoded.
MAX_SIGNATURE_BYTES = 512 * 1024
MAX_SIGNATURE_B64_CHARS = (MAX_SIGNATURE_BYTES * 4) // 3 + 4

_PNG_DATA_URL_PREFIX = "data:image/png;base64,"


class HandoverTokenResponse(BaseModel):
    """One frame of the driver's rotating QR."""

    scan_url: str
    expires_at: datetime
    # Echoed from settings rather than hard-coded in the app, so the rotation cadence
    # is a server-side decision and an already-installed APK follows a change to it.
    rotate_after_seconds: int


class HandoverStatusResponse(BaseModel):
    """What the driver's step polls while waiting for the receiver to scan."""

    confirmed: bool
    confirmed_at: Optional[datetime] = None
    # The artifact the driver then submits as pod_signature_artifact_id. Null until the
    # receiver has confirmed — the step must not let the driver past while it is null,
    # because ConfirmationCompleteRequest requires it and would 422.
    signature_artifact_id: Optional[UUID] = None


class HandoverScanResponse(BaseModel):
    """What a receiver is shown before they confirm anything.

    Scoped hard. A stranger holding a token sees what they need in order to know they
    are confirming the right delivery, and nothing else: no driver name, no phone
    number, no addresses beyond the destination they are standing in, no other stop on
    the trip. The token is unguessable, but "unguessable" is not a reason to hand a
    scanner the trip's contents.
    """

    trip_reference: str
    destination_name: str
    waybill_references: list[str]
    expires_at: datetime


class HandoverConfirmRequest(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=120)
    # Advisory shape only, never validated as an SA ID. A receiver may legitimately
    # present a passport or a company registration number, and a mistyped digit is
    # itself part of the record of what was produced at the door — the same reasoning
    # PodSignature.tsx applied to the field this replaces.
    receiver_id_number: str = Field(min_length=1, max_length=60)
    signature_png_base64: str = Field(max_length=MAX_SIGNATURE_B64_CHARS)
    receiver_lat: Optional[Decimal] = None
    receiver_lng: Optional[Decimal] = None
    receiver_accuracy_m: Optional[Decimal] = None

    @field_validator("signature_png_base64")
    @classmethod
    def validate_png(cls, v: str) -> str:
        """Accept a bare base64 payload or a full data URL, and prove it decodes.

        Decoding here rather than in the endpoint means a malformed body is a 422 from
        the schema, which is where every other bad request in this codebase is decided
        — and it means the endpoint never has to hold a half-validated blob.
        """
        payload = v[len(_PNG_DATA_URL_PREFIX):] if v.startswith(_PNG_DATA_URL_PREFIX) else v
        try:
            decoded = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("signature_png_base64 is not valid base64.") from exc
        if len(decoded) > MAX_SIGNATURE_BYTES:
            raise ValueError(f"Signature exceeds the {MAX_SIGNATURE_BYTES} byte limit.")
        if not decoded.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("signature_png_base64 is not a PNG.")
        return payload


class HandoverConfirmResponse(BaseModel):
    """Deliberately thin. The receiver has no further business with this trip."""

    confirmed_at: datetime
    trip_reference: str
```

- [ ] **Step 2: Export them** — add the five names to `backend/app/schemas/__init__.py` alongside the existing schema re-exports, matching the file's current style.

- [ ] **Step 3: Verify**

Run: `cd backend && python -c "from app.schemas.handover import HandoverConfirmRequest as R; import base64; png=base64.b64encode(b'\\x89PNG\\r\\n\\x1a\\ndata').decode(); print(R(receiver_name='A', receiver_id_number='1', signature_png_base64=png).signature_png_base64[:8])"`
Expected: the first 8 characters of the base64 string, no exception.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/handover.py backend/app/schemas/__init__.py
git commit -m "feat(api): handover wire schemas with PNG validation (FP-239)"
```

---

### Task 7: The four endpoints

**Files:**
- Create: `backend/app/api/v1/endpoints/handover.py`
- Modify: `backend/app/main.py` — **SHARED FILE**
- Test: `backend/tests/integration/test_handover_endpoints.py`

- [ ] **Step 1: Write the failing integration tests**

```python
"""FP-239 — the four handover routes end to end.

The assertion that matters most here is the negative one: every way a token can fail
must produce a byte-identical response, because the public page is reachable by anyone
holding a guess and must not tell them which part of the guess was wrong.
"""

import base64
import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import auth_header, make_token

_PNG = base64.b64encode(
    b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
).decode()


async def test_issue_requires_a_driver_token(client: AsyncClient, seeded_confirmation):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]

    res = await client.post(f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens")

    assert res.status_code == 401


async def test_issue_returns_a_scan_url_and_rotation_interval(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]

    res = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )

    assert res.status_code == 201
    body = res.json()
    assert "/h/" in body["scan_url"]
    assert body["rotate_after_seconds"] == 20


async def test_another_drivers_trip_is_a_404_not_a_403(client, seeded_confirmation, other_driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]

    res = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=other_driver_auth,
    )

    assert res.status_code == 404


async def test_scan_shows_the_delivery_without_redeeming_it(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]
    issued = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    token = issued.json()["scan_url"].rsplit("/", 1)[1]

    first = await client.get(f"/api/v1/handover/{token}")
    second = await client.get(f"/api/v1/handover/{token}")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["trip_reference"] == trip.trip_reference


async def test_every_bad_token_returns_an_identical_404(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]
    issued = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    live = issued.json()["scan_url"].rsplit("/", 1)[1]
    await client.post(f"/api/v1/handover/{live}/confirm", json={
        "receiver_name": "R", "receiver_id_number": "1", "signature_png_base64": _PNG,
    })

    unknown = await client.get(f"/api/v1/handover/{'a' * 43}")
    already_redeemed = await client.get(f"/api/v1/handover/{live}")

    assert unknown.status_code == already_redeemed.status_code == 404
    assert unknown.json() == already_redeemed.json()


async def test_confirm_creates_an_artifact_the_driver_can_submit(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]
    issued = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    token = issued.json()["scan_url"].rsplit("/", 1)[1]

    confirmed = await client.post(f"/api/v1/handover/{token}/confirm", json={
        "receiver_name": "Thandi Nkosi", "receiver_id_number": "8001015009087",
        "signature_png_base64": _PNG, "receiver_lat": "-33.9249", "receiver_lng": "18.4241",
    })

    assert confirmed.status_code == 201
    status = await client.get(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover", headers=driver_auth,
    )
    assert status.json()["confirmed"] is True
    assert status.json()["signature_artifact_id"] is not None


async def test_a_token_cannot_be_confirmed_twice(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]
    issued = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    token = issued.json()["scan_url"].rsplit("/", 1)[1]
    body = {"receiver_name": "R", "receiver_id_number": "1", "signature_png_base64": _PNG}

    first = await client.post(f"/api/v1/handover/{token}/confirm", json=body)
    second = await client.post(f"/api/v1/handover/{token}/confirm", json=body)

    assert first.status_code == 201
    assert second.status_code == 404


async def test_status_is_unconfirmed_before_any_scan(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]

    res = await client.get(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover", headers=driver_auth,
    )

    assert res.json() == {"confirmed": False, "confirmed_at": None, "signature_artifact_id": None}


async def test_a_malformed_signature_is_a_422(client, seeded_confirmation, driver_auth):
    trip, event = seeded_confirmation["trip"], seeded_confirmation["event"]
    issued = await client.post(
        f"/api/v1/trips/{trip.id}/phases/{event.id}/handover/tokens", headers=driver_auth,
    )
    token = issued.json()["scan_url"].rsplit("/", 1)[1]

    res = await client.post(f"/api/v1/handover/{token}/confirm", json={
        "receiver_name": "R", "receiver_id_number": "1", "signature_png_base64": "not base64!!",
    })

    assert res.status_code == 422
```

Add the three fixtures — `seeded_confirmation`, `driver_auth`, `other_driver_auth` — to `backend/tests/integration/conftest.py`. Build `seeded_confirmation` on the existing `seed` fixture there, adding a `PhaseEvent` row with `phase_type=PhaseType.CONFIRMATION`, `status=PhaseStatus.PENDING`, and the seeded stop's id. Build the auth headers with the existing `make_token` / `auth_header` helpers from `tests/conftest.py`, matching how other integration modules in this repo do it.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && pytest tests/integration/test_handover_endpoints.py -v`
Expected: FAIL — every route 404s, because no router is registered yet.

- [ ] **Step 3: Write the endpoints**

```python
"""Receiver QR handover routes (FP-155).

Two routers with deliberately different auth postures, in one module because they are
two halves of one exchange and splitting them would hide that:

  * `router`        — driver-authenticated. Issues the rotating QR and reports whether
                      the receiver has confirmed yet.
  * `public_router` — NO authentication at all. The capability token in the path IS the
                      authorisation, which is the entire design (db/models/handover.py):
                      the secret moves optically, in person, and a receiver has no
                      account to sign in to.

The public half is the only unauthenticated write-capable surface in this API. Three
rules govern it and none of them are negotiable:

  1. Every failure looks the same. A wrong, expired, retired or already-redeemed token
     all produce one 404 with one detail string. The true reason is written to
     handover_token_attempts by the service and read by nobody over HTTP.
  2. It reads back almost nothing. A scanner learns which delivery they are confirming
     and no more — see HandoverScanResponse's docstring.
  3. It is rate-limited per IP, because a receiver has no token to count against.
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_driver
from app.core.config import settings
from app.core.limits import HANDOVER_ISSUE, HANDOVER_PUBLIC
from app.core.rate_limit import rate_limit
from app.db.models.enums import ArtifactType, PhaseType
from app.db.models.handover import HandoverCapabilityToken
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Consignment, Trip, TripStop
from app.db.session import get_db
from app.orchestration.artifact_service import create_receiver_artifact
from app.orchestration.handover_service import (
    build_scan_url,
    load_handover_confirmation,
    record_handover_confirmation,
    redeem_capability_token,
    rotate_capability_token,
)
from app.schemas.handover import (
    HandoverConfirmRequest,
    HandoverConfirmResponse,
    HandoverScanResponse,
    HandoverStatusResponse,
    HandoverTokenResponse,
)
from app.schemas.people import DriverRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/phases/{phase_event_id}/handover", tags=["handover"])
public_router = APIRouter(prefix="/handover", tags=["handover"])

# The single response every public failure produces. One constant, referenced twice,
# so the two routes cannot drift into distinguishable messages — which would hand a
# guesser exactly the oracle rule 1 above exists to deny them.
_GENERIC_NOT_FOUND = "This delivery confirmation link is not valid."


def _not_found() -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=_GENERIC_NOT_FOUND)


async def _load_confirmation_event(
    db: AsyncSession, *, trip_id: UUID, phase_event_id: UUID, driver_id: UUID,
) -> PhaseEvent:
    """Resolve a confirmation phase event the given driver actually owns.

    Ownership is checked in the same query, not after it, and a driver who does not own
    the trip gets the same 404 as a trip that does not exist. This mirrors the fix
    recorded as NEW-12 in the Stage 3 phase-refactor plan: complete_phase used to check
    the phase type before the driver, so a foreign trip_id plus a deliberately wrong
    phase type leaked the row's real type in the error body. Same threat model here —
    a trip id read off dispatch chatter — and the same answer.
    """
    event = (
        await db.execute(
            select(PhaseEvent)
            .join(Trip, Trip.id == PhaseEvent.trip_id)
            .where(
                PhaseEvent.id == phase_event_id,
                PhaseEvent.trip_id == trip_id,
                PhaseEvent.phase_type == PhaseType.CONFIRMATION,
                Trip.driver_id == driver_id,
            )
        )
    ).scalar_one_or_none()

    if event is None or event.trip_stop_id is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Confirmation phase not found.",
        )
    return event


@router.post(
    "/tokens",
    response_model=HandoverTokenResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Issue the next QR in the rotating series",
    dependencies=[Depends(rate_limit(HANDOVER_ISSUE))],
)
async def issue_handover_token_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandoverTokenResponse:
    event = await _load_confirmation_event(
        db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
    )

    # Refuse to re-open a handover that already happened. Without this the driver could
    # keep minting tokens against a confirmed delivery, and every one of them would be a
    # live grant to overwrite a confirmation the receiver has already given.
    if await load_handover_confirmation(db, phase_event_id=event.id) is not None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="This delivery has already been confirmed by the receiver.",
        )

    try:
        raw_token, token = await rotate_capability_token(
            db, phase_event_id=event.id, trip_id=trip_id, trip_stop_id=event.trip_stop_id,
        )
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to issue a handover token for phase_event=%s", phase_event_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not issue a handover code.",
        ) from None

    return HandoverTokenResponse(
        scan_url=build_scan_url(raw_token),
        expires_at=token.expires_at,
        rotate_after_seconds=settings.HANDOVER_ROTATION_SECONDS,
    )


@router.get("", response_model=HandoverStatusResponse, summary="Has the receiver confirmed yet?")
async def handover_status_endpoint(
    trip_id: UUID,
    phase_event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_driver: DriverRead = Depends(get_current_driver),
) -> HandoverStatusResponse:
    event = await _load_confirmation_event(
        db, trip_id=trip_id, phase_event_id=phase_event_id, driver_id=current_driver.id,
    )
    confirmation = await load_handover_confirmation(db, phase_event_id=event.id)

    if confirmation is None:
        return HandoverStatusResponse(confirmed=False)
    return HandoverStatusResponse(
        confirmed=True,
        confirmed_at=confirmation.confirmed_at,
        signature_artifact_id=confirmation.signature_artifact_id,
    )


async def _live_token(db: AsyncSession, raw_token: str) -> HandoverCapabilityToken:
    """Look a presented token up for the READ path only — never for redemption.

    Redemption goes through redeem_capability_token, whose conditional UPDATE is the
    only thing allowed to decide that a token is spendable. This helper exists so the
    scan page can render, and it deliberately raises the same generic 404 for every
    reason a token might not be showable.
    """
    from app.orchestration.handover_service import _hash_token

    token = (
        await db.execute(
            select(HandoverCapabilityToken).where(
                HandoverCapabilityToken.token_hash == _hash_token(raw_token)
            )
        )
    ).scalar_one_or_none()

    if token is None or token.redeemed_at is not None:
        raise _not_found()
    from datetime import UTC, datetime

    if token.expires_at <= datetime.now(UTC):
        raise _not_found()
    return token


@public_router.get(
    "/{raw_token}",
    response_model=HandoverScanResponse,
    summary="What the receiver is about to confirm (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def scan_handover_endpoint(
    raw_token: str,
    db: AsyncSession = Depends(get_db),
) -> HandoverScanResponse:
    token = await _live_token(db, raw_token)

    trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
    stop = (
        await db.execute(
            select(TripStop).options(selectinload(TripStop.precinct))
            .where(TripStop.id == token.trip_stop_id)
        )
    ).scalar_one()
    waybills = (
        await db.execute(
            select(Consignment.parcel_perfect_reference)
            .where(Consignment.delivery_stop_id == token.trip_stop_id)
        )
    ).scalars().all()

    return HandoverScanResponse(
        trip_reference=trip.trip_reference,
        destination_name=stop.precinct.name if stop.precinct is not None else "Destination",
        waybill_references=[w for w in waybills if w],
        expires_at=token.expires_at,
    )


@public_router.post(
    "/{raw_token}/confirm",
    response_model=HandoverConfirmResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="The receiver confirms the delivery (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def confirm_handover_endpoint(
    raw_token: str,
    payload: HandoverConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> HandoverConfirmResponse:
    import base64
    from datetime import UTC, datetime

    token = await _live_token(db, raw_token)

    # The gate. Everything above this line was a read; this is the single conditional
    # UPDATE that decides whether this delivery gets confirmed, and two simultaneous
    # scans race the database here rather than racing each other in Python.
    result = await redeem_capability_token(
        db, trip_id=token.trip_id, trip_stop_id=token.trip_stop_id, raw_token=raw_token,
    )
    if not result.success:
        # The attempt has already been logged by the service with its true reason. The
        # caller gets the same 404 as every other failure.
        await db.commit()
        raise _not_found()

    trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
    signature_bytes = base64.b64decode(payload.signature_png_base64)

    try:
        artifact = await create_receiver_artifact(
            db,
            trip_id=token.trip_id,
            file_bytes=signature_bytes,
            mime_type="image/png",
            artifact_type=ArtifactType.DOCUMENT,
            # Server clock. The receiver's phone clock is not evidence of anything.
            captured_at=datetime.now(UTC),
            captured_lat=payload.receiver_lat,
            captured_lng=payload.receiver_lng,
        )
        confirmation = await record_handover_confirmation(
            db,
            token=token,
            signature_artifact_id=artifact.id,
            receiver_lat=payload.receiver_lat,
            receiver_lng=payload.receiver_lng,
            receiver_accuracy_m=payload.receiver_accuracy_m,
            receiver_ip=request.client.host if request.client else None,
            receiver_user_agent=request.headers.get("user-agent"),
            # FP-240. A camera scan opens a clean browser context with no Authorization
            # header; anything that HAS one was already holding a session of ours.
            bearer_token_present=bool(request.headers.get("authorization")),
        )
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to record a handover confirmation for token=%s", result.token_id)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not record the confirmation.",
        ) from None

    return HandoverConfirmResponse(
        confirmed_at=confirmation.confirmed_at, trip_reference=trip.trip_reference,
    )
```

Move the three function-local imports (`base64`, `datetime`, `_hash_token`) to the module header once the file compiles — they are inline above only to keep each block self-contained while reading the plan.

- [ ] **Step 4: Register the routers** — in `backend/app/main.py`, import both and add them beside the existing includes:

```python
app.include_router(handover_router, prefix="/api/v1")
app.include_router(handover_public_router, prefix="/api/v1")
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && pytest tests/integration/test_handover_endpoints.py -v`
Expected: all PASS.

- [ ] **Step 6: Run the whole suite**

Run: `cd backend && pytest`
Expected: green. Requires `TEST_DATABASE_URL` — without it pytest silently SKIPS the DB tests and a green run means nothing.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/endpoints/handover.py backend/app/main.py backend/tests/integration/
git commit -m "feat(api): driver-scoped and public receiver handover routes (FP-239)"
```

---

## Stage 2 — The shared contract

### Task 8: Rename the step slug

This is the one task that touches another developer's surface. It changes three files across two languages that a contract test holds together, and they must land in **one commit**.

**Files:**
- Modify: `frontend/shared/lib/constants/phase-meta.ts` — **SHARED FILE**
- Modify: `backend/app/core/phase_meta.py`

- [ ] **Step 1: Change the TypeScript side**

In `STEP_SLUGS.confirmation`, replace `'2-pod-signature'` with `'2-receiver-handover'`. In `STEP_NAMES.confirmation`, replace `'Capture Signature'` with `'Receiver Handover'`. Add above the confirmation line:

```ts
  // '2-pod-signature' became '2-receiver-handover' (2026-09-13, FP-155). The step no
  // longer captures anything on the driver's phone: it displays a rotating QR, and the
  // signature is produced on the RECEIVER's own device, on the public page that scan
  // opens. The slug keeps its number, per the note above — the prefix orders the recipe
  // and renumbering would break every deep link and stored draft key — but the name had
  // to change, because a driver standing on this step signs nothing.
```

- [ ] **Step 2: Change the Python side identically**

In `backend/app/core/phase_meta.py`, `PhaseType.CONFIRMATION`'s tuple becomes
`("1-pod-photo", "2-receiver-handover", "3-reconciliation", "4-closed")`, with the same comment in Python form.

- [ ] **Step 3: Run the contract test**

Run: `cd backend && pytest tests/unit/test_phase_meta_contract.py -v`
Expected: PASS. This test parses the **TypeScript** file, so a failure here means the two sides disagree — fix the disagreement, never the test.

- [ ] **Step 4: Commit both sides together**

```bash
git add frontend/shared/lib/constants/phase-meta.ts backend/app/core/phase_meta.py
git commit -m "feat(shared): rename confirmation step 2 to receiver-handover (FP-155)"
```

⚠️ **Tell the team in standup before pushing this.** `frontend/shared/` and the phase contract are cross-dev surfaces, and any branch with a confirmation-phase draft in flight will see the slug change under it.

---

### Task 9: Move the attestation renderer into shared

**Files:**
- Create: `frontend/shared/lib/utils/render-attestation.ts`
- Create: `frontend/shared/lib/utils/sa-id.ts`
- Delete: `frontend/driver-pwa/lib/utils/render-attestation.ts`, `frontend/driver-pwa/lib/utils/sa-id.ts`
- Move: the two `__tests__` files alongside them

- [ ] **Step 1: Move the two files, and the two things `render-attestation` depends on**

```bash
git mv frontend/driver-pwa/lib/utils/render-attestation.ts frontend/shared/lib/utils/render-attestation.ts
git mv frontend/driver-pwa/lib/utils/sa-id.ts frontend/shared/lib/utils/sa-id.ts
```

`sa-id.ts` is pure string logic and moves untouched. `render-attestation.ts` does **not** — it has two driver-app imports that must be resolved or the receiver app cannot compile it:

```ts
import { ATTESTATION_CANVAS_COLOURS } from '@/lib/tokens'
import type { DriverPosition } from '@/lib/types/location'
```

Create `frontend/shared/lib/types/position.ts`:

```ts
// A position fix as a browser reports it, in the shape the attestation renderer draws.
//
// Deliberately NOT driver-pwa's DriverPosition, despite being structurally identical.
// Two surfaces now produce one of these — the driver's phone during a phase, and the
// RECEIVER's browser at handover (FP-155) — and a type named for the driver would be a
// lie on half its uses. driver-pwa keeps DriverPosition for its own trail and hooks,
// and re-exports nothing: the two types are the same shape because a browser geolocation
// fix is the same thing in both places, not because one depends on the other.
export interface PositionFix {
  lat: number
  lng: number
  /** Metres of horizontal uncertainty, when the platform reports one. */
  accuracyM: number | null
}
```

Create `frontend/shared/lib/constants/attestation-colours.ts`, moving `ATTESTATION_CANVAS_COLOURS` out of `driver-pwa/lib/tokens.ts` verbatim, comment block included. In `driver-pwa/lib/tokens.ts`, replace the definition with a re-export so nothing else in that app breaks:

```ts
// Moved to shared (2026-09-13, FP-155) — the receiver app renders the same document.
// Re-exported rather than deleted so existing importers in this app are untouched.
export { ATTESTATION_CANVAS_COLOURS } from '@shared/lib/constants/attestation-colours'
```

Then in the moved `render-attestation.ts`, change the two imports to:

```ts
import { ATTESTATION_CANVAS_COLOURS } from '@shared/lib/constants/attestation-colours'
import type { PositionFix } from '@shared/lib/types/position'
```

and replace every `DriverPosition` in that file with `PositionFix`. Nothing else in the file changes — the canvas logic is untouched.

Add one line to the header of `render-attestation.ts`:

```ts
// Moved here from driver-pwa (2026-09-13, FP-155): the attestation is now rendered on
// the RECEIVER's device, in frontend/receiver, and the driver app no longer renders one
// at all. It lives in shared/ because two surfaces draw the same artifact and a second
// copy would let them drift into producing two different images for one evidence type.
```

- [ ] **Step 2: Repoint every importer**

Run: `grep -rn "utils/render-attestation\|utils/sa-id\|DriverPosition" frontend --include="*.ts" --include="*.tsx" | grep -v node_modules`

Change each `@/lib/utils/X` to `@shared/lib/utils/X`. Leave `DriverPosition` alone everywhere except inside the moved renderer — driver-pwa's hooks keep using it.

- [ ] **Step 3: Type-check**

Run: `cd frontend/driver-pwa && npm run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/shared/lib/utils frontend/driver-pwa/lib/utils
git commit -m "refactor(shared): move render-attestation and sa-id to shared for the receiver app (FP-155)"
```

---

## Stage 3 — Driver PWA

### Task 10: The handover API client

**Files:**
- Create: `frontend/driver-pwa/lib/api/handover.ts`

- [ ] **Step 1: Write it**

```ts
// frontend/driver-pwa/lib/api/handover.ts
//
// The driver's half of the receiver handover (FP-155). Two calls, both authenticated as
// the driver: mint the next QR in the rotating series, and ask whether the receiver has
// confirmed yet.
//
// Neither call is queued offline, and that is deliberate rather than an omission. A
// capability token is only useful while a receiver is standing in front of the driver
// with a phone, and a token minted from a queue that drained twenty minutes later is a
// grant nobody asked for. Offline, the step says so and the driver waits for signal —
// see ReceiverHandover.tsx.

import { api } from '@/lib/api/client'

export interface HandoverTokenResponse {
  /** The full URL encoded into the QR. Composed server-side — never built here. */
  scan_url: string
  expires_at: string
  /** Server-owned cadence, so an installed APK follows a change without a rebuild. */
  rotate_after_seconds: number
}

export interface HandoverStatusResponse {
  confirmed: boolean
  confirmed_at: string | null
  /**
   * The artifact the receiver's browser produced, which the driver then submits as
   * ConfirmationCompleteRequest.pod_signature_artifact_id. Null until they confirm —
   * the step must not let the driver past while it is null, or the phase 422s.
   */
  signature_artifact_id: string | null
}

export function issueHandoverToken(
  tripId: string, phaseEventId: string,
): Promise<HandoverTokenResponse> {
  return api.post<HandoverTokenResponse>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/handover/tokens`,
  )
}

export function fetchHandoverStatus(
  tripId: string, phaseEventId: string,
): Promise<HandoverStatusResponse> {
  return api.get<HandoverStatusResponse>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/handover`,
  )
}
```

- [ ] **Step 2: Type-check and commit**

Run: `cd frontend/driver-pwa && npm run type-check`

```bash
git add frontend/driver-pwa/lib/api/handover.ts
git commit -m "feat(driver-pwa): handover API client (FP-238)"
```

---

### Task 11: The rotation + polling hook

**Files:**
- Create: `frontend/driver-pwa/lib/hooks/useRotatingHandover.ts`
- Test: `frontend/driver-pwa/lib/hooks/__tests__/useRotatingHandover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRotatingHandover } from '@/lib/hooks/useRotatingHandover'

vi.mock('@/lib/api/handover', () => ({
  issueHandoverToken: vi.fn(),
  fetchHandoverStatus: vi.fn(),
}))

const { issueHandoverToken, fetchHandoverStatus } = await import('@/lib/api/handover')

const TRIP = 'trip-1'
const EVENT = 'event-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(issueHandoverToken).mockResolvedValue({
    scan_url: 'https://r.test/h/aaa', expires_at: '2026-09-13T10:10:00Z', rotate_after_seconds: 20,
  })
  vi.mocked(fetchHandoverStatus).mockResolvedValue({
    confirmed: false, confirmed_at: null, signature_artifact_id: null,
  })
})

describe('useRotatingHandover', () => {
  it('issues a token on mount', async () => {
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await waitFor(() => expect(result.current.scanUrl).toBe('https://r.test/h/aaa'))
  })

  it('re-issues when the rotation interval elapses', async () => {
    vi.useFakeTimers()
    renderHook(() => useRotatingHandover(TRIP, EVENT))
    await vi.waitFor(() => expect(issueHandoverToken).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(issueHandoverToken).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('stops rotating and reports the artifact once the receiver confirms', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchHandoverStatus).mockResolvedValue({
      confirmed: true, confirmed_at: '2026-09-13T10:05:00Z', signature_artifact_id: 'art-1',
    })
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })

    expect(result.current.signatureArtifactId).toBe('art-1')
    const issuedByNow = vi.mocked(issueHandoverToken).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(issueHandoverToken).toHaveBeenCalledTimes(issuedByNow)
    vi.useRealTimers()
  })

  it('surfaces an issue failure without crashing the step', async () => {
    vi.mocked(issueHandoverToken).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.scanUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend/driver-pwa && npx vitest run lib/hooks/__tests__/useRotatingHandover.test.tsx`
Expected: FAIL — module not found. (Check `node -v` first: this repo needs Node 22, and the default 18 cannot start vitest at all.)

- [ ] **Step 3: Implement the hook**

```ts
// frontend/driver-pwa/lib/hooks/useRotatingHandover.ts
//
// Owns the two clocks the receiver-handover step runs on (FP-237/238): the rotation
// that replaces the displayed QR, and the poll that watches for the receiver's
// confirmation landing server-side.
//
// They are separate intervals on purpose. The rotation cadence is a security parameter
// the server owns (HANDOVER_ROTATION_SECONDS, echoed on every issue response); the poll
// cadence is a responsiveness choice this app owns. Tying them together would mean
// either polling as slowly as the QR rotates — leaving the driver staring at a screen
// for twenty seconds after the receiver has already finished — or minting tokens as
// fast as we poll, which is the loop HANDOVER_ISSUE's rate budget exists to refuse.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHandoverStatus, issueHandoverToken } from '@/lib/api/handover'

// How often the driver's screen asks whether the receiver has confirmed. Fast enough
// that the step advances while the receiver is still handing the phone back; slow
// enough that a ten-minute handover is 200 requests, not 6000.
const POLL_INTERVAL_MS = 3_000

// Fallback cadence used only if a response somehow arrives without one. Matches the
// server default so a missing field degrades to the intended behaviour rather than to
// a tight loop.
const FALLBACK_ROTATION_SECONDS = 20

export interface RotatingHandover {
  /** The URL to encode into the QR, or null before the first token lands. */
  scanUrl: string | null
  /** Set once the receiver has confirmed — this is what the step submits. */
  signatureArtifactId: string | null
  confirmedAt: string | null
  /** Non-null when the LAST issue attempt failed. The previous QR stays on screen. */
  error: string | null
  isIssuing: boolean
  /** Manual re-issue, for the retry button on the error state. */
  refresh: () => void
}

export function useRotatingHandover(tripId: string, phaseEventId: string): RotatingHandover {
  const [scanUrl, setScanUrl] = useState<string | null>(null)
  const [signatureArtifactId, setSignatureArtifactId] = useState<string | null>(null)
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isIssuing, setIsIssuing] = useState(false)

  // Read by both timers to stop all work the moment the handover is done. A ref, not
  // the state above, because the interval callbacks close over their creation-time
  // scope and would otherwise keep firing against a stale `false`.
  const isDoneRef = useRef(false)
  const rotationSecondsRef = useRef(FALLBACK_ROTATION_SECONDS)

  const issue = useCallback(async () => {
    if (isDoneRef.current) return
    setIsIssuing(true)
    try {
      const res = await issueHandoverToken(tripId, phaseEventId)
      rotationSecondsRef.current = res.rotate_after_seconds > 0
        ? res.rotate_after_seconds
        : FALLBACK_ROTATION_SECONDS
      setScanUrl(res.scan_url)
      setError(null)
    } catch (err) {
      // The previously displayed QR is deliberately LEFT on screen. It is still valid
      // until its own expiry, so blanking it would take a working code away from a
      // receiver mid-scan because a later refresh failed.
      console.warn('[handover] could not issue the next QR:', err)
      setError('Could not refresh the code. Check your signal.')
    } finally {
      setIsIssuing(false)
    }
  }, [tripId, phaseEventId])

  useEffect(() => {
    void issue()
    const timer = setInterval(() => {
      if (isDoneRef.current) return
      void issue()
    }, rotationSecondsRef.current * 1_000)
    return () => clearInterval(timer)
  }, [issue])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (isDoneRef.current) return
      try {
        const res = await fetchHandoverStatus(tripId, phaseEventId)
        if (cancelled || !res.confirmed) return
        isDoneRef.current = true
        setSignatureArtifactId(res.signature_artifact_id)
        setConfirmedAt(res.confirmed_at)
      } catch (err) {
        // Swallowed to a warning on purpose: a poll is a read that will be retried in
        // three seconds, and surfacing every transient failure would put an error under
        // a QR that is working perfectly well.
        console.warn('[handover] status poll failed:', err)
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [tripId, phaseEventId])

  return { scanUrl, signatureArtifactId, confirmedAt, error, isIssuing, refresh: () => void issue() }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend/driver-pwa && npx vitest run lib/hooks/__tests__/useRotatingHandover.test.tsx`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/lib/hooks/useRotatingHandover.ts frontend/driver-pwa/lib/hooks/__tests__/
git commit -m "feat(driver-pwa): rotating handover token hook with confirmation polling (FP-237)"
```

---

### Task 12: The QR component

**Files:**
- Modify: `frontend/driver-pwa/package.json` — **SHARED FILE**
- Create: `frontend/driver-pwa/components/ui/QrCode.tsx`

- [ ] **Step 1: Add the dependency**

Run: `cd frontend/driver-pwa && npm install qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.5`

`qrcode` is chosen over the alternatives because it renders to a canvas with no React wrapper, no runtime CDN fetch, and no DOM assumptions that break under `output: 'export'`.

- [ ] **Step 2: Write the component**

```tsx
// frontend/driver-pwa/components/ui/QrCode.tsx
//
// Renders a payload as a QR on a canvas (FP-238).
//
// Error-correction level H, which is the highest available and costs about 30% more
// modules for the same data. That trade is correct here and nowhere else in the app:
// this code is read across a warehouse, off a screen that may be scratched, greasy,
// dimmed by a battery saver, or held at an angle, by a phone camera nobody configured.
// A QR that needs two attempts costs the driver a conversation.
'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

interface QrCodeProps {
  /** The URL to encode. Null renders the placeholder rather than an empty canvas. */
  value: string | null
  /** Rendered size in CSS pixels. The canvas is drawn at 2x for retina sharpness. */
  size?: number
}

const DEFAULT_SIZE = 260
const RETINA_SCALE = 2

export function QrCode({ value, size = DEFAULT_SIZE }: QrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || value === null) return

    let cancelled = false
    QRCode.toCanvas(canvas, value, {
      width: size * RETINA_SCALE,
      margin: 2,
      errorCorrectionLevel: 'H',
      // Pure black on pure white, never the theme tokens. A QR is read by a camera,
      // not by a person, and a themed low-contrast rendering is a code that does not
      // scan — this is the one surface in the app that must ignore dark mode.
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(() => { if (!cancelled) setFailed(false) })
      .catch((err: unknown) => {
        // Rendering can fail if the payload exceeds QR capacity. The step needs to say
        // so rather than show a blank white square the receiver will keep scanning.
        console.error('[qr] could not render the handover code:', err)
        if (!cancelled) setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, size])

  if (value === null || failed) {
    return (
      <div
        className="flex animate-pulse items-center justify-center rounded-xl bg-surface-container-high"
        style={{ width: size, height: size }}
        role="status"
        aria-label={failed ? 'Code unavailable' : 'Generating code'}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="rounded-xl bg-white"
      aria-label="Delivery confirmation QR code"
    />
  )
}
```

- [ ] **Step 3: Type-check and commit**

Run: `cd frontend/driver-pwa && npm run type-check`

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json frontend/driver-pwa/components/ui/QrCode.tsx
git commit -m "feat(driver-pwa): QR code component for the receiver handover (FP-238)"
```

⚠️ `package.json` is a shared file — flag the new dependency to the team.

---

### Task 13: The step component

**Files:**
- Create: `frontend/driver-pwa/components/phase/steps/confirmation/ReceiverHandover.tsx`
- Test: `frontend/driver-pwa/components/phase/steps/confirmation/__tests__/ReceiverHandover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiverHandover } from '../ReceiverHandover'

vi.mock('@/lib/hooks/useRotatingHandover', () => ({ useRotatingHandover: vi.fn() }))
vi.mock('@/components/ui/QrCode', () => ({
  QrCode: ({ value }: { value: string | null }) => <div data-testid="qr">{value ?? 'none'}</div>,
}))

const { useRotatingHandover } = await import('@/lib/hooks/useRotatingHandover')

const phase = {
  phase_event_id: 'event-1', trip_id: 'trip-1', phase_type: 'confirmation',
  trip_stop_id: 'stop-1', stop_sequence: 1, sequence_number: 6, status: 'pending',
  anchor_status: 'not_required', step_recipe: ['1-pod-photo', '2-receiver-handover'],
} as never

const draft = {
  podPhotoDataUrl: null, podPhotoArtifactId: null, podSignatureArtifactId: null,
  receiverConfirmedAt: null, driverVisualCount: null, reconciliationNote: null, capturedAt: null,
} as never

function setup(overrides: Partial<ReturnType<typeof useRotatingHandover>> = {}) {
  vi.mocked(useRotatingHandover).mockReturnValue({
    scanUrl: 'https://r.test/h/aaa', signatureArtifactId: null, confirmedAt: null,
    error: null, isIssuing: false, refresh: vi.fn(), ...overrides,
  })
}

beforeEach(() => vi.clearAllMocks())

describe('ReceiverHandover', () => {
  it('shows the QR while waiting for the receiver', () => {
    setup()
    render(<ReceiverHandover tripId="trip-1" phase={phase} stepIndex={1} draft={draft}
      onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.getByTestId('qr')).toHaveTextContent('https://r.test/h/aaa')
  })

  it('offers no way forward until the receiver has confirmed', () => {
    setup()
    render(<ReceiverHandover tripId="trip-1" phase={phase} stepIndex={1} draft={draft}
      onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.queryByText(/continue/i)).not.toBeInTheDocument()
  })

  it('writes the artifact into the draft once the receiver confirms', async () => {
    const onUpdate = vi.fn()
    setup({ signatureArtifactId: 'art-1', confirmedAt: '2026-09-13T10:05:00Z' })
    render(<ReceiverHandover tripId="trip-1" phase={phase} stepIndex={1} draft={draft}
      onUpdate={onUpdate} onComplete={vi.fn()} />)

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      podSignatureArtifactId: 'art-1', receiverConfirmedAt: '2026-09-13T10:05:00Z',
    }))
  })

  it('shows the retry affordance when issuing failed', () => {
    setup({ error: 'Could not refresh the code. Check your signal.' })
    render(<ReceiverHandover tripId="trip-1" phase={phase} stepIndex={1} draft={draft}
      onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/confirmation/__tests__/ReceiverHandover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// frontend/driver-pwa/components/phase/steps/confirmation/ReceiverHandover.tsx
//
// Replaces PodSignature.tsx (FP-155). The driver no longer collects the signature.
//
// BQ2 (2026-06-29) said proof of delivery is a photo AND a signature, both required.
// That still holds — the artifact is still produced, still uploaded, still required at
// submit. What changed is WHERE it is produced: on the receiver's own phone, reached by
// scanning the rotating QR this step displays. The property that matters is not who the
// receiver is (we still cannot prove that) but that the confirmation was produced
// somewhere the driver's device is not. See docs/iteration2-feedback-response-2026-08-25.md §7.
//
// This step captures nothing locally and has no evidence of its own. Its entire job is
// to display a code, wait, and write the resulting artifact id into the draft that
// ConfirmationCompleteRequest.pod_signature_artifact_id is built from.
'use client'

import { useEffect } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { QrCode } from '@/components/ui/QrCode'
import { Button } from '@/components/ui/Button'
import { useRotatingHandover } from '@/lib/hooks/useRotatingHandover'
import { formatTime } from '@/lib/utils/format-time'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface ReceiverHandoverProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function ReceiverHandover({
  tripId, phase, stepIndex, draft, onUpdate, onComplete,
}: ReceiverHandoverProps) {
  const { scanUrl, signatureArtifactId, confirmedAt, error, isIssuing, refresh } =
    useRotatingHandover(tripId, phase.phase_event_id)

  // The draft, not component state, is what survives the driver backgrounding the app
  // mid-handover — usePhaseDraft persists it. Written in an effect rather than during
  // render because it is a side effect on a parent-owned store.
  useEffect(() => {
    if (signatureArtifactId === null) return
    if (draft.podSignatureArtifactId === signatureArtifactId) return
    onUpdate({ podSignatureArtifactId: signatureArtifactId, receiverConfirmedAt: confirmedAt })
  }, [signatureArtifactId, confirmedAt, draft.podSignatureArtifactId, onUpdate])

  // The draft is the source of truth for "has this happened", not the hook: a driver
  // who backgrounds the app and returns gets a remounted hook with no confirmation yet,
  // and must not be sent back to a QR for a delivery already confirmed.
  const isConfirmed = draft.podSignatureArtifactId !== null

  if (isConfirmed) {
    return (
      <main className="flex min-h-dvh flex-col">
        <StepHeader phase={phase} stepIndex={stepIndex} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary-container">
            <span className="text-3xl" aria-hidden="true">✓</span>
          </div>
          <p className="text-xl font-medium text-surface-on">Receiver confirmed the delivery</p>
          {draft.receiverConfirmedAt !== null && (
            <p className="text-base text-surface-on-variant">
              Signed at {formatTime(draft.receiverConfirmedAt)}
            </p>
          )}
          <p className="max-w-sm text-sm text-surface-on-variant">
            Their signature was recorded on their own device, with their own location.
          </p>
        </div>
        <div className="flex justify-center px-6 pt-6 pb-safe">
          <SwipeToConfirm label="Continue" onConfirm={onComplete} />
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col items-center gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Ask the receiver to scan this code with their phone camera. They sign on their
          own device.
        </p>

        {/* White plate, always — the QR must not inherit a dark theme (QrCode.tsx). */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <QrCode value={scanUrl} />
        </div>

        <div className="flex flex-col items-center gap-1">
          <p className="text-base font-medium text-surface-on">Waiting for the receiver…</p>
          <p className="text-sm text-surface-on-variant">
            The code refreshes on its own. An old photo of it will not work.
          </p>
        </div>

        {error !== null && (
          <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-error/40 bg-error-container/30 p-4">
            <p className="text-center text-sm text-surface-on">{error}</p>
            <Button variant="outline" onClick={refresh} disabled={isIssuing}>
              {isIssuing ? 'Refreshing…' : 'Try again'}
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
```

Before writing this, open `components/ui/Button.tsx` and confirm the `variant` prop accepts `"outline"`; if it does not, use whatever secondary variant it defines. Do not invent a variant.

- [ ] **Step 4: Run the tests**

Run: `cd frontend/driver-pwa && npx vitest run components/phase/steps/confirmation/__tests__/ReceiverHandover.test.tsx`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/driver-pwa/components/phase/steps/confirmation/ReceiverHandover.tsx frontend/driver-pwa/components/phase/steps/confirmation/__tests__/ReceiverHandover.test.tsx
git commit -m "feat(driver-pwa): receiver handover step replacing on-device signature (FP-155)"
```

---

### Task 14: Wire it into the phase flow and retire the old step

**Files:**
- Modify: `frontend/driver-pwa/components/phase/steps/registry.ts`
- Modify: `frontend/driver-pwa/lib/types/evidence-draft.ts`
- Modify: `frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx` (`CONFIRMATION_INITIAL_BASE`, ~line 56)
- Delete: `components/phase/steps/confirmation/PodSignature.tsx`, `components/phase/DigitalSignature.tsx`, and their `__tests__`

- [ ] **Step 1: Change the draft type**

In `ConfirmationEvidence`, remove `podSignatureDataUrl`, `recipientName` and `recipientIdNumber`; add `receiverConfirmedAt`. Keep `podSignatureArtifactId`. Replace the block comment on those fields with:

```ts
  // Set from the handover poll (lib/hooks/useRotatingHandover.ts), never rendered on
  // this device. podSignatureDataUrl, recipientName and recipientIdNumber are gone with
  // PodSignature.tsx (FP-155): the attestation PNG is now rendered in the RECEIVER's
  // browser and uploaded by the server, so the driver's phone never holds the image and
  // never holds the receiver's identity at all.
  //
  // POPIA: this is strictly better than what it replaces. The receiver's ID number used
  // to sit in this draft, in this handset's localStorage, until the phase submitted. It
  // now never touches the driver's device — it goes from the receiver's own browser into
  // the rendered PNG in Supabase Storage (af-south-1) and nowhere else.
  podSignatureArtifactId: string | null
  // Server-stamped instant the receiver confirmed. Display only — the evidence of when
  // is the HandoverConfirmation row, not this copy.
  receiverConfirmedAt: string | null
```

- [ ] **Step 2: Update `CONFIRMATION_INITIAL_BASE`**

```ts
const CONFIRMATION_INITIAL_BASE: Omit<ConfirmationEvidence, 'driverVisualCount'> = {
  podPhotoDataUrl: null, podPhotoArtifactId: null,
  podSignatureArtifactId: null, receiverConfirmedAt: null,
  reconciliationNote: null, capturedAt: null,
}
```

- [ ] **Step 3: Update the registry**

Change the import from `PodSignature` to `ReceiverHandover`, change `ConfirmationSlug`'s `'2-pod-signature'` to `'2-receiver-handover'`, and change the `confirmation` map entry to `'2-receiver-handover': ReceiverHandover,`.

- [ ] **Step 4: Delete the retired components**

```bash
git rm frontend/driver-pwa/components/phase/steps/confirmation/PodSignature.tsx \
       frontend/driver-pwa/components/phase/steps/confirmation/__tests__/PodSignature.test.tsx \
       frontend/driver-pwa/components/phase/DigitalSignature.tsx \
       frontend/driver-pwa/components/phase/__tests__/DigitalSignature.test.tsx
```

`SignaturePad.tsx` was already dead before this change (DigitalSignature replaced it). Run `grep -rn "SignaturePad" frontend/driver-pwa --include="*.tsx" | grep -v node_modules` and delete it too **only if** nothing outside its own test imports it.

- [ ] **Step 5: Fix every resulting break**

Run: `cd frontend/driver-pwa && npm run type-check`
Expected: errors in `Reconciliation.tsx` and/or `Closed.tsx` if either reads `recipientName` or `podSignatureDataUrl`. Open each and replace the reference — `Closed.tsx` should show `receiverConfirmedAt` where it previously showed the signature. Re-run until clean.

- [ ] **Step 6: Run the registry contract test and the full suite**

Run: `cd frontend/driver-pwa && npx vitest run`
Expected: green. `components/phase/steps/__tests__/registry.test.ts` asserts the registry and `STEP_SLUGS` agree in both directions — it will fail if Task 8 and this task disagree.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/driver-pwa
git commit -m "feat(driver-pwa): retire on-device POD signature for the receiver handover (FP-155)"
```

---

## Stage 4 — The receiver app

### Task 15: Scaffold `frontend/receiver`

**Files:** all new, under `frontend/receiver/`

- [ ] **Step 1: Create the package**

`frontend/receiver/package.json` — versions pinned to match the other two apps exactly, so the monorepo has one React and one Next:

```json
{
  "name": "freightproof-receiver",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.5.25",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: `next.config.js`**

```js
const path = require('path')

// The receiver app is opened by strangers from a QR code, on a link they did not type
// and cannot verify. Its headers are therefore stricter than the dispatcher's in the
// one place that matters and looser in exactly one other.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // no-referrer, not strict-origin: the path contains a live capability token, and a
  // referrer header would leak it to any third-party origin the page ever touches.
  // Nothing here is worth the risk of that token walking out in a Referer.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Geolocation is ALLOWED here, unlike on the dispatcher. The receiver's independent
  // position fix is the single most valuable thing this page collects — it is the third
  // source, from a party with no incentive to help the driver. Camera and microphone
  // stay denied: this page renders a signature, it does not capture media.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
```

- [ ] **Step 3: `tsconfig.json`** — copy `frontend/dispatcher/tsconfig.json` verbatim, then confirm its `paths` maps `@shared/*` to `../shared/*` and `@/*` to `./*`. The `@shared` alias is required: this app imports `render-attestation` and `sa-id` from Task 9.

- [ ] **Step 4: `tailwind.config.ts` and `postcss.config.js`** — copy from `frontend/dispatcher/`, and set `content` to `['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}']`. Use `content`, never `purge`.

- [ ] **Step 5: Install and verify the shell builds**

Run: `cd frontend/receiver && npm install && npm run build`
Expected: a successful Next build (it will warn about no pages until Task 16 — that is fine).

- [ ] **Step 6: Commit**

```bash
git add frontend/receiver
git commit -m "chore(receiver): scaffold the public receiver scan app (FP-239)"
```

---

### Task 16: The scan page

**Files:**
- Create: `frontend/receiver/lib/api.ts`, `app/layout.tsx`, `app/globals.css`, `app/h/[token]/page.tsx`, `app/h/[token]/HandoverPageClient.tsx`, `components/Swipe.tsx`

- [ ] **Step 1: `lib/api.ts`**

```ts
// frontend/receiver/lib/api.ts
//
// This app talks to exactly two endpoints and holds no session. There is no bearer
// token to attach and no refresh path to get wrong — the capability token in the URL
// is the whole authorisation, which is why this file is thirty lines and the driver
// app's client is two hundred.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export class HandoverError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HandoverError'
  }
}

export interface HandoverScan {
  trip_reference: string
  destination_name: string
  waybill_references: string[]
  expires_at: string
}

export interface ConfirmPayload {
  receiver_name: string
  receiver_id_number: string
  signature_png_base64: string
  receiver_lat: number | null
  receiver_lng: number | null
  receiver_accuracy_m: number | null
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new HandoverError(res.status, (body as { detail?: string }).detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export async function fetchScan(token: string): Promise<HandoverScan> {
  return parse<HandoverScan>(await fetch(`${BASE_URL}/api/v1/handover/${token}`, { cache: 'no-store' }))
}

export async function confirmHandover(
  token: string, payload: ConfirmPayload,
): Promise<{ confirmed_at: string; trip_reference: string }> {
  return parse(await fetch(`${BASE_URL}/api/v1/handover/${token}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}
```

- [ ] **Step 2: `app/h/[token]/page.tsx`**

```tsx
// Server Component. It renders the shell and hands the token to the client half —
// deliberately does NOT fetch the scan server-side, because the fetch must carry the
// receiver's own network identity, not our server's, and because a server-rendered
// 404 would cache a token's death.
import { HandoverPageClient } from './HandoverPageClient'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function HandoverPage({ params }: PageProps) {
  const { token } = await params
  return <HandoverPageClient token={token} />
}
```

- [ ] **Step 3: `components/Swipe.tsx`**

A port of `driver-pwa/components/phase/SwipeToConfirm.tsx`. **Read that file first and copy it**, stripping its driver-app imports (`@/lib/utils/cn` and any token imports — inline the classes). Do not write a new swipe from scratch: the original already handles the pointer, keyboard and tap-to-confirm paths, and its `disabled` handling is the real identity gate this page depends on.

- [ ] **Step 4: `app/h/[token]/HandoverPageClient.tsx`**

```tsx
// frontend/receiver/app/h/[token]/HandoverPageClient.tsx
//
// The receiver's whole experience (FP-239). Opened from a QR by someone with no
// account, no app and no prior relationship with this system, usually one-handed, on a
// warehouse floor. Four states and nothing else: loading, invalid, ready, done.
//
// The page is deliberately incurious about WHY a token is invalid. The API returns one
// generic 404 for expired, unknown, retired and already-redeemed alike, so that the
// page cannot be used as an oracle to probe for live tokens — and this client must not
// undo that by inferring a reason from a status code and explaining it.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Swipe } from '@/components/Swipe'
import { confirmHandover, fetchScan, type HandoverScan } from '@/lib/api'
import { renderAttestation } from '@shared/lib/utils/render-attestation'
import { hasRecipientIdentity, looksLikeSaIdNumber } from '@shared/lib/utils/sa-id'
import type { PositionFix } from '@shared/lib/types/position'

// Ceiling on the browser geolocation prompt. A receiver who ignores the permission
// dialog must not leave the delivery unconfirmable — the fix is valuable evidence, not
// a precondition, so the swipe proceeds without one rather than hanging on it.
const GEO_TIMEOUT_MS = 8_000

type Status = 'loading' | 'invalid' | 'ready' | 'signing' | 'done'

/** Resolves to a fix, or to null on refusal, failure or timeout. Never rejects. */
function capturePosition(): Promise<PositionFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      }),
      // A denied permission and a failed fix are the same outcome here: no position.
      // The absence is recorded server-side as null, which is itself part of the record.
      () => resolve(null),
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

export function HandoverPageClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('loading')
  const [scan, setScan] = useState<HandoverScan | null>(null)
  const [name, setName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchScan(token)
      .then((res) => { if (!cancelled) { setScan(res); setStatus('ready') } })
      .catch((err: unknown) => {
        if (cancelled) return
        // Every failure lands here identically, including a network error. Telling a
        // receiver with no signal that their link is invalid is a small lie; telling a
        // prober which of their guesses was live is a security hole. The lie is cheaper.
        console.warn('[handover] scan lookup failed:', err)
        setStatus('invalid')
      })
    return () => { cancelled = true }
  }, [token])

  const handleSign = useCallback(async () => {
    if (scan === null || !hasRecipientIdentity(name, idNumber)) return
    setStatus('signing')

    // Fix taken at the swipe, never on mount: a position captured when the page opened
    // could be minutes and a building away from where the receiver actually signed, and
    // the attestation claims the latter. Same reasoning as the driver-side original.
    const fix = await capturePosition()
    const signedAt = new Date().toISOString()

    const dataUrl = renderAttestation({
      signedAt,
      position: fix,
      tripId: scan.trip_reference,
      recipientName: name.trim(),
      recipientIdNumber: idNumber.trim(),
    })

    if (dataUrl === null) {
      setMessage('The signature could not be generated on this device. Please try again.')
      setStatus('ready')
      return
    }

    try {
      await confirmHandover(token, {
        receiver_name: name.trim(),
        receiver_id_number: idNumber.trim(),
        signature_png_base64: dataUrl,
        receiver_lat: fix?.lat ?? null,
        receiver_lng: fix?.lng ?? null,
        receiver_accuracy_m: fix?.accuracyM ?? null,
      })
      setStatus('done')
    } catch (err: unknown) {
      // A failed confirm may have burned the token (the redemption is the first thing
      // the server does), so the honest state is "this link is finished" rather than an
      // encouraging retry that would 404 and confuse them further.
      console.warn('[handover] confirm failed:', err)
      setStatus('invalid')
    }
  }, [scan, name, idNumber, token])

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-neutral-500">Loading delivery…</p>
      </main>
    )
  }

  if (status === 'invalid') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900">This link is no longer valid</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Ask the driver to show you a fresh code. Codes refresh regularly and each one
          can only be used once.
        </p>
      </main>
    )
  }

  if (status === 'done') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
          <span className="text-3xl" aria-hidden="true">✓</span>
        </div>
        <h1 className="text-xl font-medium text-neutral-900">Delivery confirmed</h1>
        <p className="max-w-sm text-sm text-neutral-600">
          Thank you. You can close this page — nothing else is needed from you.
        </p>
      </main>
    )
  }

  const showIdShapeHint = idNumber.trim().length > 0 && !looksLikeSaIdNumber(idNumber)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium text-neutral-900">Confirm this delivery</h1>
        <p className="text-sm text-neutral-600">
          {scan?.destination_name} · {scan?.trip_reference}
        </p>
      </header>

      {scan !== null && scan.waybill_references.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-medium text-neutral-900">Waybills</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-neutral-600">
            {scan.waybill_references.map((ref) => <li key={ref}>{ref}</li>)}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-900">Your full name</span>
          <input
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            value={name} autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-900">Your ID number</span>
          <input
            className="rounded-lg border border-neutral-300 px-3 py-3 text-base"
            value={idNumber} inputMode="numeric" autoComplete="off"
            onChange={(e) => setIdNumber(e.target.value)}
          />
          {/* Advisory, never a gate. A receiver may legitimately present a passport or a
              company registration number, and a mistyped digit is itself evidence of
              what was produced at the door — carried from PodSignature.tsx, where the
              reasoning was identical and remains correct on a different device. */}
          {showIdShapeHint && (
            <span className="text-xs text-neutral-500">
              This is not a 13 digit SA ID number. It will still be recorded as entered.
            </span>
          )}
        </label>
      </div>

      <div className="rounded-xl border border-neutral-200 p-4">
        <p className="text-base font-medium text-neutral-900">By signing, you confirm:</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-neutral-600">
          <li>• The delivery was received</li>
          <li>• Your name and ID number are recorded</li>
          <li>• The time of signing is recorded</li>
          <li>• Your device&apos;s location is recorded, if you allow it</li>
        </ul>
      </div>

      {message !== '' && <p className="text-sm text-red-600">{message}</p>}

      <div className="mt-auto pb-6">
        <Swipe
          label={status === 'signing' ? 'Confirming…' : 'Swipe to confirm delivery'}
          disabled={!hasRecipientIdentity(name, idNumber) || status === 'signing'}
          onConfirm={handleSign}
        />
      </div>
    </main>
  )
}
```

`app/layout.tsx` is a plain Server Component shell importing `./globals.css` (the three Tailwind directives) and setting `<html lang="en-ZA">`. Give it a `viewport` export with `width: 'device-width', initialScale: 1` — this page is only ever read on a phone.

- [ ] **Step 5: Verify by hand, on a real phone**

Run: `cd backend && uvicorn app.main:app --reload --host 0.0.0.0` and `cd frontend/receiver && npm run dev`, then set `HANDOVER_RECEIVER_BASE_URL` to your machine's LAN address (`http://192.168.x.x:3002`) and restart the backend.

Walk a seeded trip to confirmation in the driver app, reach `2-receiver-handover`, and scan the QR **with a second physical phone**. Expected: the receiver page loads, shows the trip reference and destination, takes a name/ID, asks for location permission, and on swipe shows the confirmed state — while the driver's screen advances to the confirmed view within ~3 seconds without being touched.

The dev DB may need a reseed if it holds pre-phase-refactor trips.

- [ ] **Step 6: Commit**

```bash
git add frontend/receiver
git commit -m "feat(receiver): public scan page with receiver-side signature and GPS (FP-239)"
```

---

## Stage 5 — Close out

### Task 17: Full verification

- [ ] **Step 1:** `cd backend && pytest` — green, with `TEST_DATABASE_URL` set.
- [ ] **Step 2:** `cd backend && alembic heads` — exactly one head.
- [ ] **Step 3:** `cd frontend/driver-pwa && npm run type-check && npx vitest run && npm run lint`
- [ ] **Step 4:** `cd frontend/dispatcher && npm run type-check` — it imports the shared `phase-meta.ts` Task 8 changed. Node 22 required.
- [ ] **Step 5:** `cd frontend/receiver && npm run type-check && npm run build`
- [ ] **Step 6:** `cd frontend/driver-pwa && npm run cap:sync` — the QR must render inside the Android shell, not just in a desktop browser.

### Task 18: Update the docs the team reads

- [ ] **Step 1:** In `CLAUDE.md`, the Domain knowledge section says "Receiver = one-time OTP." That is now wrong — decision 2 in `iteration3_plan.md` §8 closed it as "there is no receiver OTP to replace." Change it to "Receiver = one-time QR capability token, no account (FP-155)." **`CLAUDE.md` requires a 4-reviewer PR** — raise it, do not merge it quietly.
- [ ] **Step 2:** Update `frontend/client-portal/README.md`'s auth line, which also claims a receiver OTP.
- [ ] **Step 3:** Add `frontend/receiver` to whatever CI workflow builds the other two frontends.

---

## Addendum — what changed during implementation (2026-09-13)

The plan above was written before the code. Three things changed while building it, and
the built version is the authority. Recorded here rather than silently edited into the
tasks, so the reasoning survives.

### 1. `opened_at` — the rotation had to be able to stop

**The plan was wrong.** As written, the QR re-issues every 20 seconds and each new frame
retires the one before it. A receiver scans at T, then spends thirty to sixty seconds
typing their name and ID number, and by the time they swipe their token has been retired
by two rotations they never saw. **Every real handover would have failed at the last
step.**

Fixed by adding `handover_capability_tokens.opened_at`, set when the receiver's browser
first loads the page. `rotate_capability_token` will neither retire an opened token nor
issue a successor to one, so the code in the receiver's hand stays alive until they finish
or it expires on its own. A photograph of the driver's screen still dies within one
interval, because a photograph never opens the page.

This also improved the driver's screen: `receiver_opened` on both driver-facing responses
lets the step say *"the receiver has opened the link"* instead of leaving the driver
watching a code with no idea whether the scan worked.

### 2. `session_secret_hash` — browser binding against a forwarded link

Added after the question *"is it hardware locked to his specific device so he can't share
that session to another device"*.

It cannot be hardware-locked — no browser exposes a MAC address, and CGNAT makes South
African mobile IPs useless as identifiers (both already documented in
`docs/iteration2-feedback-response-2026-08-25.md` §7). A capability token in a URL is a
**bearer** credential: screenshot it, send it on, and the recipient can spend it.

What *is* available is **browser** binding. The first load of a token's page mints a
second secret, returns it as an `HttpOnly; SameSite=Strict` cookie, and stores only its
SHA-256. Confirming requires both halves. A forwarded URL arrives at a browser with no
cookie and mints no new one, because minting is conditional on `opened_at` being NULL.

Honest about its limits, and these belong in the report: it binds a **browser profile**,
not hardware. Handing someone an unlocked phone defeats it; so does copying a cookie out
of devtools. It stops the casual forward, which is the realistic threat.

**Deployment constraint this creates:** the cookie is `SameSite=Strict`, so the receiver
app and the API must share a registrable domain (`receiver.example.co.za` and
`api.example.co.za` do; two unrelated domains do not). Put them on unrelated domains and
the cookie is silently never sent, every handover fails its binding check, and the generic
404 it produces says nothing about why. Recorded in `config.py` beside `ALLOWED_ORIGINS`.

### 3. `force` — an escape hatch the pause made necessary

Consequence of (1) and (2) together: a receiver who opens the link and then loses the
browser session holding their cookie (private tab closed, second load in a different
browser) can neither confirm nor be issued a fresh code, because the rotation is paused
for them, until the ten-minute grant expires.

`POST .../handover/tokens?force=true` retires the stranded token, binding and all, and
restarts the series. Surfaced in the driver step as *"Receiver having trouble? Show a new
code"*, shown only once the link has been opened.

### Smaller corrections

- `TripStop` has no `precinct` relationship, only the FK. The scan route joins `Precinct`
  explicitly rather than using `selectinload`.
- `create_artifact` never set `captured_by_user_id`, so `_persist_artifact` does not take
  it. Both attribution columns stay NULL for a receiver artifact.
- Missing driver credentials produce **403**, not 401 — `get_current_driver` reserves 401
  for a token that is present but unusable.
- Raw hex is banned in component code by eslint, so the QR's black/white pair lives in
  `lib/tokens.ts` as `QR_CANVAS_COLOURS`, following the `ATTESTATION_CANVAS_COLOURS`
  precedent.
- `render-attestation.ts` had two driver-app imports, so the move to `shared/` also had to
  move `ATTESTATION_CANVAS_COLOURS` and introduce `PositionFix` (the renderer's position
  type, no longer named for the driver).
- The receiver app's `Swipe` is a purpose-built ~150-line component, **not** a port of
  driver-pwa's `SwipeToConfirm`. That component's three hundred lines are design-system
  tokens, tap-to-confirm preferences and spinner variants earned by being the control
  every driver phase submits through; none of it applies to a page with one button. The
  safety property — no confirmation from a single accidental tap — is carried over.
- `vi.clearAllMocks()` does not drain a `mockResolvedValueOnce` queue. Two confirmation
  tests queued two uploads and now consume one, and the leftover leaked into the next test
  and beat its `mockRejectedValue`. Both were corrected to queue exactly one.

---

## Known gaps, stated rather than hidden

1. **A driver with two phones still defeats this.** He can read the token off his own screen and POST it himself. The design documents already concede this in terms (`docs/iteration2-feedback-response-2026-08-25.md` §7, "The honest framing"). What this buys is a *provable* fraud: an independent GPS fix, a distinct user-agent, an IP, and a timestamp that must all line up with a story. Tier 2 — a client-nominated contact — is the next rung and is not in this plan.
2. **The handover record is not in the anchored payload.** The feedback response wants the handover hashed into the confirmation canonical payload. Doing that changes a payload `verification_service` rebuilds for every historical trip, which is a separate, carefully-sequenced ticket. The signature artifact's own hash is already covered by the existing artifact chain.
3. **`bearer_token_present` is a weak FP-240.** It catches a lazy driver using the app's own webview; it does not catch a driver opening a private browser tab. A stronger signal would compare the receiver's fix against the driver's phone fix captured at the same phase — worth a follow-up ticket, and cheap now that both are recorded.
4. **No offline path, by design.** A capability token is worthless minted into an offline queue. If the driver has no signal at the destination, the handover cannot happen — which is a real operational limitation worth raising with Bruce, not a bug.
