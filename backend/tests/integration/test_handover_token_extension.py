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
