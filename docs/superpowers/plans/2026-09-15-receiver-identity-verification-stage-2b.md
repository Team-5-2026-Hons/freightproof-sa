# Receiver Identity Verification — Stage 2B (HTTP Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

> **⚠ GIT RULE.** `CLAUDE.md` forbids `git commit/push/merge/rebase/checkout/reset/restore/stash`.
> Every "commit" step **stages only** (`git add` on named files).

> **⚠ NEVER write to a database from a command.** `DATABASE_URL` is the shared Supabase dev
> database. No `alembic upgrade`. Tests use `TEST_DATABASE_URL` (local) and are fine.

**Goal:** Expose Stage 2A's service layer over HTTP — consent, verify, resolve, and a signed
webhook — plus the sweeper that enforces the spec's "no trip ends PENDING" invariant.

**Architecture:** Four routes added to the EXISTING `public_router` in
`api/v1/endpoints/handover.py` (already registered in `main.py`, so no shared-file change).
Endpoints stay thin: validate, call `receiver_verification_service`, return. Every public
failure returns the same generic 404 that FP-155 established.

**Tech Stack:** Python 3.13, FastAPI 0.115+, Pydantic v2, SQLAlchemy 2.0 async, Celery, pytest.

**Spec:** `docs/superpowers/specs/2026-09-14-receiver-identity-verification-design.md`
**Depends on:** Stage 2A (all service functions exist and are tested)

---

## Known environment facts (tell every implementer)

- Interpreter `backend/.venv/bin/python`, tests `backend/.venv/bin/pytest`. Plain
  `python`/`pytest` are NOT on PATH.
- `TEST_DATABASE_URL` is set. Integration tests must PASS, not skip. **A skip is not a pass.**
- **Known pre-existing baseline: 38 errors** in `tests/integration/test_analytics.py` and
  `test_analytics_endpoints.py` — local PostgreSQL is 14.18 and those views need
  `security_invoker` (PG15+). NOT ours. Ignore entirely.
- `RuntimeError: Event loop is closed` Redis teardown noise is harmless. Judge by the
  pytest summary line only.
- A ruff hook blocks writes on unused imports (F401). Keep imports tight.
- Current green baseline: **1462 passed, 0 failed, 38 errors.**

## ⚠ Enum comparison trap (bit us once already)

Every enum column in this codebase is `mapped_column(String(20))`, **not** a SQLAlchemy
`Enum`. The `Mapped[SomeEnum]` annotation is a typing hint and does not coerce on load, so
a row read in a fresh session returns a bare `str`.

**Always compare these with `==` / `!=`, never `is` / `is not`.** Value comparison works
because the enums subclass `str`; identity comparison silently fails for anything loaded
from the database. It passes in tests where the object is still in the session's identity
map, and fails in production where every request has its own session — the worst possible
failure shape. The rest of the codebase already uses `==`; match it.

`is` remains correct for pure in-memory enums that never touch the database, such as
`IdvsDecisionStatus` inside `resolve_verdict`.

## Security rules this stage must enforce (spec §7)

1. **`/verify/resolve` accepts NO session identifier from the client.** Empty body. The
   server reads `provider_session_id` from its own row. This is the whole feature's
   integrity: the receiver route is unauthenticated, so a client-nameable session would let
   anyone with a live QR self-declare VERIFIED.
2. **Every public failure is the same generic 404.** No new oracle.
3. **Webhook is HMAC-verified and idempotent** — Didit retries 5× with backoff.
4. **A late webhook never changes a terminal status** — it annotates only.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/schemas/handover.py` *(modify)* | Consent/verify/resolve wire shapes |
| `backend/app/api/v1/endpoints/handover.py` *(modify)* | Four new public routes + confirm wiring |
| `backend/app/orchestration/receiver_verification_service.py` *(modify)* | Webhook ingestion + sweeper query |
| `backend/app/core/limits.py` *(modify, **shared**)* | `IDVS_WEBHOOK` budget |
| `backend/app/tasks/verification.py` *(create)* | Abandonment sweeper |
| `backend/app/tasks/__init__.py` *(modify, **shared**)* | Register the task + beat entry |
| `backend/tests/integration/test_receiver_verification_endpoints.py` *(create)* | Route behaviour |
| `backend/tests/integration/test_receiver_verification_webhook.py` *(create)* | HMAC, idempotency, late decisions |

---

## Task 1: Wire shapes

**Files:** Modify `backend/app/schemas/handover.py`

- [ ] **Step 1: Append the schemas**

```python
class HandoverConsentRequest(BaseModel):
    """The receiver's explicit agreement to a biometric identity check.

    POPIA s27(1)(a) is the exemption this feature relies on to process biometrics at all,
    and that exemption is only as good as proof of WHAT was agreed to. The client sends the
    exact wording it displayed; the server stores its SHA-256, never the text.

    `consent_text` is bounded so an anonymous caller cannot post a novel into an
    unauthenticated route.
    """

    consent_text: str = Field(min_length=1, max_length=4000)
    # False when the receiver says they have no ID document on them. Not a refusal — it
    # routes them to the selfie-only tier, which still confirms the delivery.
    has_document: bool = True


class HandoverVerifyResponse(BaseModel):
    """Where to send the receiver next, or why we are not sending them anywhere.

    `session_url` is None on every degradation path — quota spent, vendor unreachable, no
    document. The client reads that as "go straight to signing at a lower tier", never as
    an error, because the delivery must remain confirmable.
    """

    session_url: Optional[str] = None
    tier: str
    unverified_reason: Optional[str] = None


class HandoverVerificationState(BaseModel):
    """What the receiver's page shows about its own verification."""

    status: str
    tier: str
    unverified_reason: Optional[str] = None
    identity_match: Optional[bool] = None
```

- [ ] **Step 2: Verify**

```bash
cd backend && .venv/bin/python -c "from app.schemas.handover import HandoverConsentRequest, HandoverVerifyResponse, HandoverVerificationState; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Stage** — `git add backend/app/schemas/handover.py`

Suggested: `feat(api): wire shapes for receiver verification`

---

## Task 2: Rate limit for the webhook

**Files:** Modify `backend/app/core/limits.py` **(shared — flag it)**

- [ ] **Step 1: Append after `IDVS_VERIFY`**

```python
# The vendor's webhook. Higher than IDVS_VERIFY because Didit retries a failed delivery up
# to five times with exponential backoff, and a legitimate burst of retries must not be
# throttled into permanent loss. Still bounded: it is a public, unauthenticated route, and
# an attacker who cannot forge the HMAC gains nothing by flooding it except our CPU.
IDVS_WEBHOOK = RateLimit(max_requests=60, window_seconds=_ONE_MINUTE, name="idvs_webhook")
```

- [ ] **Step 2: Verify**

```bash
cd backend && .venv/bin/python -c "from app.core.limits import IDVS_WEBHOOK; print(IDVS_WEBHOOK.name, IDVS_WEBHOOK.max_requests)"
```

Expected: `idvs_webhook 60`

- [ ] **Step 3: Stage** — `git add backend/app/core/limits.py`

---

## Task 3: Webhook verification and ingestion (service layer)

**Files:**
- Modify: `backend/app/orchestration/receiver_verification_service.py`
- Test: `backend/tests/integration/test_receiver_verification_webhook.py`

- [ ] **Step 1: Write the failing test**

```python
"""The vendor webhook: signature, idempotency, and the late-decision rule.

This is a public, unauthenticated, write-capable route. The HMAC is the only thing
separating a real vendor decision from a forged one."""

import hashlib
import hmac
import json
import uuid

from sqlalchemy import select

from app.core.config import settings
from app.db.models.enums import ReceiverVerificationStatus
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.orchestration.receiver_verification_service import (
    ingest_webhook_decision,
    verify_webhook_signature,
)

_SECRET = "test-webhook-secret"


def _sign(body: bytes, secret: str = _SECRET) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_a_correct_signature_verifies(monkeypatch):
    monkeypatch.setattr(settings, "IDVS_WEBHOOK_SECRET", _SECRET)
    body = json.dumps({"session_id": "s1", "status": "Approved"}).encode()

    assert verify_webhook_signature(body, _sign(body)) is True


def test_a_wrong_signature_does_not_verify(monkeypatch):
    monkeypatch.setattr(settings, "IDVS_WEBHOOK_SECRET", _SECRET)
    body = json.dumps({"session_id": "s1", "status": "Approved"}).encode()

    assert verify_webhook_signature(body, _sign(body, "wrong-secret")) is False


def test_a_missing_signature_does_not_verify(monkeypatch):
    monkeypatch.setattr(settings, "IDVS_WEBHOOK_SECRET", _SECRET)

    assert verify_webhook_signature(b"{}", None) is False


def test_an_unset_secret_refuses_everything(monkeypatch):
    """Fail closed. An unconfigured secret must not mean 'accept anything'."""
    monkeypatch.setattr(settings, "IDVS_WEBHOOK_SECRET", "")

    assert verify_webhook_signature(b"{}", _sign(b"{}")) is False


async def test_ingest_moves_a_pending_row_to_terminal(db_session, pending_verification):
    await ingest_webhook_decision(
        db_session,
        payload={"session_id": pending_verification.provider_session_id, "status": "Declined"},
    )

    await db_session.refresh(pending_verification)
    assert pending_verification.status is ReceiverVerificationStatus.FAILED


async def test_ingest_is_idempotent_across_retries(db_session, pending_verification):
    payload = {"session_id": pending_verification.provider_session_id, "status": "Declined"}

    await ingest_webhook_decision(db_session, payload=payload)
    await ingest_webhook_decision(db_session, payload=payload)
    await ingest_webhook_decision(db_session, payload=payload)

    rows = (
        await db_session.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.id == pending_verification.id
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].status is ReceiverVerificationStatus.FAILED


async def test_a_late_webhook_annotates_but_does_not_change_a_terminal_status(
    db_session, terminal_verification,
):
    """The spec's invariant: a closed trip must not be rewritten by a late arrival."""
    await ingest_webhook_decision(
        db_session,
        payload={"session_id": terminal_verification.provider_session_id, "status": "Declined"},
    )

    await db_session.refresh(terminal_verification)
    assert terminal_verification.status is ReceiverVerificationStatus.VERIFIED, "terminal status must stand"
    assert terminal_verification.late_decision_status == "declined"
    assert terminal_verification.late_decision_at is not None


async def test_an_unknown_session_is_ignored_without_raising(db_session):
    """Returning quietly is deliberate — the route 200s so the vendor stops retrying
    into a wall, and an unknown session is not an error we can act on."""
    await ingest_webhook_decision(
        db_session, payload={"session_id": f"never-{uuid.uuid4().hex}", "status": "Approved"},
    )
```

Add these fixtures at the top of that file (after the imports), building on the plan's
`seeded_phase_event` pattern from Stage 2A:

```python
import pytest_asyncio

from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationTier,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.orchestration.handover_service import issue_capability_token
from app.orchestration.receiver_verification_service import PROVIDER_DIDIT


@pytest_asyncio.fixture
async def seeded_phase_event(db_session, seed):
    """A CONFIRMATION phase event on an active trip — copied from
    tests/integration/test_handover_endpoints.py's handover_trip fixture."""
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-WEBHOOK",
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


async def _verification(db_session, event, *, status, session_id):
    _, token = await issue_capability_token(
        db_session, phase_event_id=event.id, trip_id=event.trip_id, trip_stop_id=event.trip_stop_id,
    )
    v = ReceiverIdentityVerification(
        id=uuid.uuid4(), token_id=token.id, trip_id=event.trip_id,
        status=status, tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        provider=PROVIDER_DIDIT, provider_session_id=session_id,
    )
    db_session.add(v)
    await db_session.flush()
    return v


@pytest_asyncio.fixture
async def pending_verification(db_session, seeded_phase_event):
    return await _verification(
        db_session, seeded_phase_event,
        status=ReceiverVerificationStatus.PENDING, session_id=f"sess-{uuid.uuid4().hex}",
    )


@pytest_asyncio.fixture
async def terminal_verification(db_session, seeded_phase_event):
    return await _verification(
        db_session, seeded_phase_event,
        status=ReceiverVerificationStatus.VERIFIED, session_id=f"sess-{uuid.uuid4().hex}",
    )
```

- [ ] **Step 2: Run, confirm ImportError**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_webhook.py -q
```

Expected: FAIL — `cannot import name 'verify_webhook_signature'`

- [ ] **Step 3: Append to `receiver_verification_service.py`**

```python
def verify_webhook_signature(raw_body: bytes, presented_signature: Optional[str]) -> bool:
    """Whether a webhook body really came from the vendor.

    FAILS CLOSED. An unset IDVS_WEBHOOK_SECRET refuses every delivery rather than accepting
    every delivery — a misconfigured deployment must lose webhooks, not accept forged ones.
    This is the only thing standing between a real decision and an attacker's, on a public
    unauthenticated route.

    compare_digest, never `==`: a byte-wise comparison leaks how much of a forged signature
    was correct, which is enough to construct one a byte at a time.
    """
    secret = settings.IDVS_WEBHOOK_SECRET
    if not secret or not presented_signature:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, presented_signature)


async def ingest_webhook_decision(
    db: AsyncSession, *, payload: dict[str, Any],
) -> None:
    """Apply a vendor-pushed decision to the verification it belongs to.

    The BACKSTOP, not the primary path. The receiver's own return trip resolves most
    verifications synchronously; this catches the ones where they closed the tab or lost
    signal before the page could poll.

    Three rules, all from the spec:

      * Unknown session — return quietly. The route 200s so the vendor stops retrying into
        a wall, and a session we never created is not something we can act on.
      * Already terminal — annotate, never overwrite. A late arrival must not rewrite a
        trip that has closed; that would break the invariant the whole ordering exists to
        protect. The finding is still kept, because this codebase records inconvenient
        facts rather than discarding them.
      * Idempotent — Didit retries up to five times. A second delivery of the same decision
        must change nothing, which falls out of the two rules above rather than needing a
        dedupe table.
    """
    session_id = payload.get("session_id")
    if not session_id:
        logger.warning("IDVS webhook carried no session_id; ignoring")
        return

    verification = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.provider_session_id == str(session_id)
            )
        )
    ).scalar_one_or_none()

    if verification is None:
        logger.info("IDVS webhook for unknown session=%s; ignoring", session_id)
        return

    decision = _parse_decision(payload, fallback_session_id=str(session_id))

    if verification.status is not ReceiverVerificationStatus.PENDING:
        verification.late_decision_status = decision.status.value
        verification.late_decision_at = datetime.now(UTC)
        await db.flush()
        logger.info(
            "Late IDVS decision for verification=%s recorded as annotation (status stands at %s)",
            verification.id, verification.status.value,
        )
        return

    verdict = resolve_verdict(status=decision.status, identity_match=verification.identity_match)
    verification.status = verdict.status
    verification.unverified_reason = verdict.unverified_reason
    verification.provider_decision_at = decision.decided_at
    await db.flush()


async def sweep_abandoned_verifications(db: AsyncSession, *, older_than_seconds: int) -> int:
    """Terminalise PENDING verifications that no decision ever arrived for.

    The enforcement arm of the spec's invariant: no trip may end with a verification in
    flight. A receiver who starts a check and closes the tab leaves a PENDING row that no
    webhook will ever resolve, and an evidence record whose state is "we are still waiting"
    a week later is not a record at all.

    Returns how many rows were terminalised, so the task can log a number rather than a
    shrug.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=older_than_seconds)
    stale = (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.status == ReceiverVerificationStatus.PENDING,
                ReceiverIdentityVerification.created_at < cutoff,
            )
        )
    ).scalars().all()

    for verification in stale:
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.ABANDONED
    await db.flush()

    if stale:
        logger.info("Swept %d abandoned receiver verifications", len(stale))
    return len(stale)
```

Imports to merge into the existing block:

```python
import hashlib
import hmac
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.integrations.idvs import _parse_decision
```

> Note: `_parse_decision` is underscore-prefixed but is the module's single quarantined
> reader of vendor JSON. Importing it here is deliberate — re-implementing the parse would
> create a second place that has to change when the real response shape arrives.

- [ ] **Step 4: Run** — expect **8 passed**

```bash
cd backend && .venv/bin/pytest tests/integration/test_receiver_verification_webhook.py -q
```

- [ ] **Step 5: Stage** both files.

Suggested: `feat(orchestration): signed webhook ingestion and abandonment sweep`

---

## Task 4: The four public routes

**Files:**
- Modify: `backend/app/api/v1/endpoints/handover.py`
- Test: `backend/tests/integration/test_receiver_verification_endpoints.py`

- [ ] **Step 1: Add the routes**

Append to `handover.py` (imports first — merge into the existing blocks):

```python
from app.core.limits import IDVS_VERIFY, IDVS_WEBHOOK
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.integrations.idvs import get_idvs_client
from app.orchestration.receiver_verification_service import (
    attach_confirmation,
    ingest_webhook_decision,
    load_verification_for_token,
    raise_verification_exception,
    record_consent,
    resolve_verification,
    start_verification,
    verify_webhook_signature,
)
from app.schemas.handover import (
    HandoverConsentRequest,
    HandoverVerificationState,
    HandoverVerifyResponse,
)
```

Then the routes:

```python
@public_router.post(
    "/{raw_token}/consent",
    response_model=HandoverVerificationState,
    status_code=http_status.HTTP_201_CREATED,
    summary="Record the receiver's consent to an identity check (public, no auth)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def handover_consent_endpoint(
    raw_token: str,
    payload: HandoverConsentRequest,
    db: AsyncSession = Depends(get_db),
) -> HandoverVerificationState:
    """Create the verification row. Must precede any vendor session.

    Consent first, always. POPIA s27(1)(a) is what makes the biometric check lawful at all,
    and a check started before consent was recorded is one we cannot justify afterwards.
    """
    token = await _live_token(db, raw_token)

    existing = await load_verification_for_token(db, token_id=token.id)
    if existing is not None:
        # Idempotent: a receiver who reloads mid-flow must not create a second row, and the
        # unique constraint on token_id would refuse it anyway.
        return _verification_state(existing)

    verification = await record_consent(db, token=token, consent_text=payload.consent_text)
    if not payload.has_document:
        verification.tier = ReceiverVerificationTier.SELFIE_ONLY
        verification.status = ReceiverVerificationStatus.UNVERIFIED
        verification.unverified_reason = ReceiverVerificationUnverifiedReason.NO_DOCUMENT

    try:
        await db.commit()
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Failed to record handover consent for token")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not record consent.",
        ) from None

    return _verification_state(verification)


@public_router.post(
    "/{raw_token}/verify",
    response_model=HandoverVerifyResponse,
    summary="Start a vendor identity session (public, no auth)",
    dependencies=[Depends(rate_limit(IDVS_VERIFY))],
)
async def handover_verify_endpoint(
    raw_token: str,
    db: AsyncSession = Depends(get_db),
) -> HandoverVerifyResponse:
    """Claim quota, create the session, extend the token, hand back a URL.

    `session_url` is None on every degradation path and that is NOT an error — the client
    proceeds to signing at a lower tier. A delivery must stay confirmable when a vendor is
    down, and this is where that promise is kept.
    """
    token = await _live_token(db, raw_token)
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        # No consent recorded — refuse, identically to every other public failure.
        raise _not_found()

    session = await start_verification(
        db, token=token, verification=verification, client=get_idvs_client(),
    )
    await db.commit()

    return HandoverVerifyResponse(
        session_url=session.session_url if session is not None else None,
        tier=verification.tier.value,
        unverified_reason=(
            verification.unverified_reason.value if verification.unverified_reason else None
        ),
    )


@public_router.post(
    "/{raw_token}/verify/resolve",
    response_model=HandoverVerificationState,
    summary="Fetch the authoritative decision (public, no auth, EMPTY BODY)",
    dependencies=[Depends(rate_limit(HANDOVER_PUBLIC))],
)
async def handover_resolve_endpoint(
    raw_token: str,
    receiver_name: str = "",
    receiver_id_number: str = "",
    db: AsyncSession = Depends(get_db),
) -> HandoverVerificationState:
    """THE security boundary. Takes no session identifier from anyone.

    The client can say "I am back" and nothing else. The session id comes from our own row,
    written before the redirect. This is the exact failure Didit patched in their own
    WordPress plugin, where a browser could post {status: "Approved"} and be believed — and
    our exposure is worse, because this route has no authentication at all by design.

    receiver_name / receiver_id_number are the typed identity to cross-check against the
    document. They are what the receiver already gave us, not a claim about the session.
    """
    token = await _live_token(db, raw_token)
    verification = await load_verification_for_token(db, token_id=token.id)
    if verification is None:
        raise _not_found()

    verdict = await resolve_verification(
        db,
        verification=verification,
        client=get_idvs_client(),
        typed_name=receiver_name,
        typed_id_number=receiver_id_number,
    )

    if verdict.exception_type is not None:
        trip = (await db.execute(select(Trip).where(Trip.id == token.trip_id))).scalar_one()
        await raise_verification_exception(
            db, trip=trip, phase_event_id=token.phase_event_id,
            trip_stop_id=token.trip_stop_id, verdict=verdict,
        )

    await db.commit()
    return _verification_state(verification)


@public_router.post(
    "/webhooks/didit",
    status_code=http_status.HTTP_200_OK,
    summary="Vendor decision webhook (public, HMAC-verified)",
    dependencies=[Depends(rate_limit(IDVS_WEBHOOK))],
)
async def handover_webhook_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Signed backstop for decisions the receiver's own return never delivered.

    Returns 200 for everything it accepts, including an unknown session — the vendor
    retries five times on a non-200, and making it retry into a wall for a session we
    never created helps nobody.

    A bad signature is the one exception: 401, logged, nothing written.
    """
    raw_body = await request.body()
    signature = request.headers.get(_DIDIT_SIGNATURE_HEADER)

    if not verify_webhook_signature(raw_body, signature):
        logger.warning("Rejected an IDVS webhook with an invalid or missing signature")
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.",
        )

    try:
        payload = json.loads(raw_body)
    except ValueError:
        logger.warning("IDVS webhook body was not valid JSON")
        # 200, not 400: the signature was ours, so retrying will not help.
        return {"status": "ignored"}

    await ingest_webhook_decision(db, payload=payload)
    await db.commit()
    return {"status": "ok"}
```

Add these module-level helpers near `_not_found`:

```python
# Header the vendor signs with. An assumed name, quarantined here like the _DIDIT_*
# constants in integrations/idvs.py — one line to change when the real one is known.
_DIDIT_SIGNATURE_HEADER = "x-signature"


def _verification_state(v: ReceiverIdentityVerification) -> HandoverVerificationState:
    return HandoverVerificationState(
        status=v.status.value,
        tier=v.tier.value,
        unverified_reason=v.unverified_reason.value if v.unverified_reason else None,
        identity_match=v.identity_match,
    )
```

And `import json` plus the enum imports
(`ReceiverVerificationTier`, `ReceiverVerificationStatus`, `ReceiverVerificationUnverifiedReason`)
merged into the existing import block.

- [ ] **Step 2: Add `load_verification_for_token` to the service**

```python
async def load_verification_for_token(
    db: AsyncSession, *, token_id: uuid.UUID,
) -> Optional[ReceiverIdentityVerification]:
    """The verification for one grant, or None if the receiver never consented."""
    return (
        await db.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.token_id == token_id
            )
        )
    ).scalar_one_or_none()
```

- [ ] **Step 3: Write the route tests**

Create `backend/tests/integration/test_receiver_verification_endpoints.py`. Reuse the
`override_get_db` and `handover_trip` fixture patterns from
`tests/integration/test_handover_endpoints.py` (read that file). Cover:

1. `POST /consent` then `GET /handover/{token}` — consent creates a PENDING row.
2. `POST /consent` twice — idempotent, one row, same response.
3. `POST /verify` with `IDVS_USE_MOCK=true` — returns a `session_url`.
4. `POST /verify` with `IDVS_MONTHLY_SESSION_LIMIT=0` — `session_url` is None,
   `unverified_reason == "quota_exhausted"`, and **no session was created**.
5. `POST /verify` without prior consent — generic 404 with the exact
   `_GENERIC_NOT_FOUND` string.
6. `POST /verify/resolve` — moves the row to a terminal status.
7. `POST /consent` with `has_document: false` — tier is `selfie_only`, reason `no_document`.
8. An unknown token on every route — the SAME generic 404 body on all of them.

Assert on `response.json()["detail"] == "This delivery confirmation link is not valid."`
for the failure cases, so a future refactor cannot drift into distinguishable messages.

- [ ] **Step 4: Run** — expect **8 passed**

- [ ] **Step 5: Stage** all three files.

Suggested: `feat(api): receiver identity verification routes and signed webhook`

---

## Task 5: Link the verification at confirm time

**Files:** Modify `backend/app/api/v1/endpoints/handover.py`

- [ ] **Step 1: Call `attach_confirmation` in `confirm_handover_endpoint`**

Immediately after `record_handover_confirmation(...)` returns and before `await db.commit()`:

```python
        # Link the verification the receiver completed before signing. Separate from the
        # confirmation row because the two happen at different moments and a receiver may
        # verify and then walk away — a verification with no confirmation is a real state,
        # not an error.
        await attach_confirmation(
            db, token_id=token.id, handover_confirmation_id=confirmation.id,
        )
```

- [ ] **Step 2: Prove the existing confirm flow still works**

```bash
cd backend && .venv/bin/pytest tests/integration/test_handover_endpoints.py -q
```

Expected: all pass. This route is FP-155's; breaking it breaks every delivery.

- [ ] **Step 3: Stage** — `git add backend/app/api/v1/endpoints/handover.py`

---

## Task 6: The abandonment sweeper

**Files:**
- Create: `backend/app/tasks/verification.py`
- Modify: `backend/app/tasks/__init__.py` **(shared — flag it)**
- Modify: `backend/app/core/config.py` **(shared — flag it)**

- [ ] **Step 1: Add the interval setting to `config.py`**

```python
    # How long a PENDING verification may sit before the sweeper calls it abandoned.
    # Comfortably longer than IDVS_DECISION_POLL_SECONDS: the receiver's own page gives up
    # first and records ABANDONED itself, so this only catches the ones where the page
    # never got to run at all — a closed tab, a dead battery.
    IDVS_ABANDON_AFTER_SECONDS: int = 1800
    IDVS_SWEEP_INTERVAL_SECONDS: int = 300
```

Add both to `backend/.env.example` as `IDVS_ABANDON_AFTER_SECONDS=1800` and
`IDVS_SWEEP_INTERVAL_SECONDS=300`.

- [ ] **Step 2: Create the task**

```python
"""Celery task: terminalise receiver verifications no decision ever arrived for.

The enforcement arm of the spec's invariant — no trip may reach a terminal state with a
verification still in flight. The receiver's own page gives up after
IDVS_DECISION_POLL_SECONDS and records the outcome itself; this catches the cases where
the page never got the chance, because the tab closed or the phone died.

Layering: tasks -> orchestration -> db.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.orchestration.receiver_verification_service import sweep_abandoned_verifications
from app.tasks import celery

logger = logging.getLogger(__name__)


async def _sweep() -> int:
    """Run one sweep on a short-lived engine.

    A fresh engine per run, as in tasks/analytics.py: a connection pool created before the
    Celery worker forks is unsafe to share with the forked child.
    """
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with session_factory() as session:
            swept = await sweep_abandoned_verifications(
                session, older_than_seconds=settings.IDVS_ABANDON_AFTER_SECONDS,
            )
            await session.commit()
            return swept
    finally:
        await engine.dispose()


@celery.task(name="tasks.verification.sweep_abandoned")
def sweep_abandoned() -> int:
    """Beat-scheduled entry point.

    Exceptions are logged and swallowed rather than retried: the next scheduled run does
    exactly the same work, so a retry storm buys nothing and a failed sweep is not a lost
    fact — the rows are still there to find.
    """
    try:
        return asyncio.run(_sweep())
    except Exception:
        logger.exception("Receiver verification sweep failed; the next run will retry")
        return 0
```

- [ ] **Step 3: Register it in `app/tasks/__init__.py`**

Add to `celery.conf.beat_schedule`:

```python
    "idvs-sweep-abandoned-verifications": {
        "task": "tasks.verification.sweep_abandoned",
        "schedule": settings.IDVS_SWEEP_INTERVAL_SECONDS,
    },
```

And at the bottom, beside the existing explicit import:

```python
from app.tasks.verification import sweep_abandoned as sweep_abandoned  # noqa: E402
```

- [ ] **Step 4: Verify registration**

```bash
cd backend && .venv/bin/python -c "
from app.tasks import celery
assert 'tasks.verification.sweep_abandoned' in celery.tasks, sorted(celery.tasks)
print('registered; beat keys:', sorted(celery.conf.beat_schedule))
"
```

Expected: includes `idvs-sweep-abandoned-verifications`

- [ ] **Step 5: Test the sweep logic** — add to
`tests/integration/test_receiver_verification_webhook.py`:

```python
async def test_sweep_terminalises_a_stale_pending_row(db_session, pending_verification):
    from app.orchestration.receiver_verification_service import sweep_abandoned_verifications

    swept = await sweep_abandoned_verifications(db_session, older_than_seconds=-1)

    assert swept >= 1
    await db_session.refresh(pending_verification)
    assert pending_verification.status is ReceiverVerificationStatus.UNVERIFIED


async def test_sweep_leaves_a_fresh_pending_row_alone(db_session, pending_verification):
    from app.orchestration.receiver_verification_service import sweep_abandoned_verifications

    swept = await sweep_abandoned_verifications(db_session, older_than_seconds=86_400)

    assert swept == 0
    await db_session.refresh(pending_verification)
    assert pending_verification.status is ReceiverVerificationStatus.PENDING
```

- [ ] **Step 6: Stage** all four files.

Suggested: `feat(tasks): sweep abandoned receiver verifications`

---

## Task 7: Full sweep

- [ ] **Step 1: Run everything**

```bash
cd backend && .venv/bin/pytest -q
```

Expected: **1462 + the new tests passed, 0 failed, 38 pre-existing errors.**

- [ ] **Step 2: Confirm no new oracle** — every public failure returns the same body.

```bash
cd backend && grep -n "_GENERIC_NOT_FOUND\|_not_found()" app/api/v1/endpoints/handover.py | head -20
```

Every public-route failure path must go through `_not_found()`.

- [ ] **Step 3: Confirm the resolve route takes no session id**

```bash
cd backend && .venv/bin/python -c "
import inspect
from app.api.v1.endpoints.handover import handover_resolve_endpoint
params = set(inspect.signature(handover_resolve_endpoint).parameters)
assert not {'session_id','provider_session_id','sessionId'} & params, params
print('resolve params:', sorted(params))
"
```

- [ ] **Step 4: TASK COMPLETE** per `CLAUDE.md`, flagging shared files
(`core/limits.py`, `core/config.py`, `tasks/__init__.py`, `.env.example`) and that nothing
is committed.

## Stage 2B done when

- [ ] Full suite green (38 known errors only)
- [ ] `/verify/resolve` accepts no session identifier
- [ ] Every public failure returns the identical generic 404
- [ ] Webhook fails closed on an unset secret, is idempotent, and never overwrites a terminal status
- [ ] Sweeper registered on the beat schedule
- [ ] Nothing committed
