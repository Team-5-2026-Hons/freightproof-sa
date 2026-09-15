"""The vendor webhook: signature, idempotency, and the late-decision rule.

This is a public, unauthenticated, write-capable route. The HMAC is the only thing
separating a real vendor decision from a forged one."""

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime

import pytest_asyncio
from sqlalchemy import select

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.receiver_verification import ReceiverIdentityVerification
from app.db.models.trips import Trip, TripStop
from app.orchestration.handover_service import issue_capability_token
from app.orchestration.receiver_verification_service import (
    PROVIDER_DIDIT,
    WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
    ingest_webhook_decision,
    verify_webhook_signature,
    webhook_timestamp_is_fresh,
)

_SECRET = "test-webhook-secret"


def _sign(body: bytes, secret: str = _SECRET) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


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
    # `==`, not `is`: status is a String(20) column, so a refresh from the DB returns a
    # plain str from the driver rather than the ReceiverVerificationStatus instance that
    # was in memory before the reload. `str, Enum` compares equal by value either way —
    # this is a round-trip identity quirk of the column type, not a status mismatch.
    assert pending_verification.status == ReceiverVerificationStatus.FAILED


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
    # `==`, not `is` — see the comment in test_ingest_moves_a_pending_row_to_terminal.
    assert terminal_verification.status == ReceiverVerificationStatus.VERIFIED, "terminal status must stand"
    assert terminal_verification.late_decision_status == "declined"
    assert terminal_verification.late_decision_at is not None


async def test_an_unknown_session_is_ignored_without_raising(db_session):
    """Returning quietly is deliberate — the route 200s so the vendor stops retrying
    into a wall, and an unknown session is not an error we can act on."""
    await ingest_webhook_decision(
        db_session, payload={"session_id": f"never-{uuid.uuid4().hex}", "status": "Approved"},
    )


async def test_ingest_resolves_a_row_loaded_fresh_from_the_database(
    db_session, pending_verification,
):
    """Regression: the webhook must still RESOLVE, not annotate, when the row is loaded
    fresh rather than found in the session's identity map.

    status is a String column, not a SQLAlchemy Enum, so a fresh load returns a bare str.
    An `is not PENDING` check would be True for every production webhook — every request
    has its own session — and the backstop would silently never resolve anything.
    """
    session_id = pending_verification.provider_session_id
    db_session.expire_all()

    await ingest_webhook_decision(
        db_session, payload={"session_id": session_id, "status": "Declined"},
    )

    reloaded = (
        await db_session.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.provider_session_id == session_id
            )
        )
    ).scalar_one()
    assert reloaded.status == ReceiverVerificationStatus.FAILED, "must resolve, not annotate"
    assert reloaded.late_decision_status is None, "a PENDING row is not a late decision"


async def test_late_decision_path_survives_a_fresh_load(db_session, terminal_verification):
    """Regression: the late-decision branch logs verification.status, which is a bare str
    on a fresh load. Reading `.value` off it raised AttributeError — a 500 on a public
    webhook route, reachable by any vendor retry against an already-resolved delivery."""
    session_id = terminal_verification.provider_session_id
    db_session.expire_all()

    await ingest_webhook_decision(
        db_session, payload={"session_id": session_id, "status": "Declined"},
    )

    reloaded = (
        await db_session.execute(
            select(ReceiverIdentityVerification).where(
                ReceiverIdentityVerification.provider_session_id == session_id
            )
        )
    ).scalar_one()
    assert reloaded.status == ReceiverVerificationStatus.VERIFIED, "terminal status must stand"
    assert reloaded.late_decision_status == "declined"


async def test_sweep_terminalises_a_stale_pending_row(db_session, pending_verification):
    from app.orchestration.receiver_verification_service import sweep_abandoned_verifications

    swept = await sweep_abandoned_verifications(db_session, older_than_seconds=-1)

    assert swept >= 1
    await db_session.refresh(pending_verification)
    assert pending_verification.status == ReceiverVerificationStatus.UNVERIFIED


async def test_sweep_leaves_a_fresh_pending_row_alone(db_session, pending_verification):
    from app.orchestration.receiver_verification_service import sweep_abandoned_verifications

    swept = await sweep_abandoned_verifications(db_session, older_than_seconds=86_400)

    assert swept == 0
    await db_session.refresh(pending_verification)
    assert pending_verification.status == ReceiverVerificationStatus.PENDING


# --- Replay protection --------------------------------------------------------
#
# A valid HMAC proves a body was written by the secret holder. It says nothing about WHEN,
# so a single captured delivery is otherwise replayable against this public route forever.


def test_a_current_timestamp_is_fresh():
    now = str(int(datetime.now(UTC).timestamp()))

    assert webhook_timestamp_is_fresh(now) is True


def test_a_timestamp_beyond_the_skew_window_is_rejected():
    stale = str(int(datetime.now(UTC).timestamp()) - WEBHOOK_MAX_CLOCK_SKEW_SECONDS - 1)

    assert webhook_timestamp_is_fresh(stale) is False


def test_a_timestamp_far_in_the_future_is_rejected():
    """Clamped on both sides: an attacker who picks their own clock must not get a pass."""
    ahead = str(int(datetime.now(UTC).timestamp()) + WEBHOOK_MAX_CLOCK_SKEW_SECONDS + 1)

    assert webhook_timestamp_is_fresh(ahead) is False


def test_a_missing_timestamp_fails_closed():
    assert webhook_timestamp_is_fresh(None) is False


def test_an_unparseable_timestamp_fails_closed():
    assert webhook_timestamp_is_fresh("not-a-number") is False
