"""raise_verification_exception — the gap/mismatch severity split, against the real DB.

The whole reason RECEIVER_ID_MISMATCH and RECEIVER_ID_UNVERIFIED exist as separate
exception types (see resolve_verdict) is that they belong in different review lanes:
a mismatch is a fraud indicator (WARNING), a gap is an ordinary handover with no ID on
hand (INFO). This file is where that split turns into an actual row, not just a Verdict.
"""

import uuid

import pytest_asyncio
from sqlalchemy import select

from app.db.models.enums import (
    AnchorStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationTier,
    ReceiverVerificationUnverifiedReason,
    TripStatus,
)
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Trip, TripStop
from app.orchestration.receiver_verification_service import (
    Verdict,
    raise_verification_exception,
)


@pytest_asyncio.fixture
async def verification_trip(db_session, seed):
    """An active trip at its destination stop, with a PENDING confirmation phase event.

    Copied from test_handover_endpoints.py's handover_trip fixture — this file needs the
    same real Trip/TripStop/PhaseEvent shape, but no consignment or driver auth, since
    raise_verification_exception is called directly rather than through an endpoint.
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

    return {"trip": trip, "stop": stop, "event": event}


async def _exception_rows(db_session, trip_id):
    result = await db_session.execute(
        select(TripException).where(TripException.trip_id == trip_id)
    )
    return result.scalars().all()


async def test_mismatch_verdict_writes_one_warning_row(db_session, verification_trip):
    trip, stop, event = (
        verification_trip["trip"], verification_trip["stop"], verification_trip["event"],
    )
    verdict = Verdict(
        status=ReceiverVerificationStatus.FAILED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
    )

    await raise_verification_exception(
        db_session, trip=trip, phase_event_id=event.id, trip_stop_id=stop.id, verdict=verdict,
    )

    rows = await _exception_rows(db_session, trip.id)
    assert len(rows) == 1
    assert rows[0].exception_type == ExceptionType.RECEIVER_ID_MISMATCH
    assert rows[0].source == ExceptionSource.SYSTEM
    assert rows[0].severity == ExceptionSeverity.WARNING
    assert rows[0].trip_id == trip.id


async def test_unverified_gap_verdict_writes_one_info_row(db_session, verification_trip):
    trip, stop, event = (
        verification_trip["trip"], verification_trip["stop"], verification_trip["event"],
    )
    verdict = Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        unverified_reason=ReceiverVerificationUnverifiedReason.ABANDONED,
        exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
    )

    await raise_verification_exception(
        db_session, trip=trip, phase_event_id=event.id, trip_stop_id=stop.id, verdict=verdict,
    )

    rows = await _exception_rows(db_session, trip.id)
    assert len(rows) == 1
    assert rows[0].exception_type == ExceptionType.RECEIVER_ID_UNVERIFIED
    assert rows[0].severity == ExceptionSeverity.INFO
    assert rows[0].trip_id == trip.id


async def test_mismatch_and_gap_land_in_different_severity_lanes(db_session, verification_trip):
    """The whole reason the two exception types exist separately."""
    trip, stop, event = (
        verification_trip["trip"], verification_trip["stop"], verification_trip["event"],
    )
    mismatch = Verdict(
        status=ReceiverVerificationStatus.FAILED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        exception_type=ExceptionType.RECEIVER_ID_MISMATCH,
    )
    gap = Verdict(
        status=ReceiverVerificationStatus.UNVERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
        unverified_reason=ReceiverVerificationUnverifiedReason.ABANDONED,
        exception_type=ExceptionType.RECEIVER_ID_UNVERIFIED,
    )

    await raise_verification_exception(
        db_session, trip=trip, phase_event_id=event.id, trip_stop_id=stop.id, verdict=mismatch,
    )
    await raise_verification_exception(
        db_session, trip=trip, phase_event_id=event.id, trip_stop_id=stop.id, verdict=gap,
    )

    rows = await _exception_rows(db_session, trip.id)
    severities_by_type = {row.exception_type: row.severity for row in rows}
    assert len(rows) == 2
    assert severities_by_type[ExceptionType.RECEIVER_ID_MISMATCH] == ExceptionSeverity.WARNING
    assert severities_by_type[ExceptionType.RECEIVER_ID_UNVERIFIED] == ExceptionSeverity.INFO


async def test_no_exception_type_writes_no_row(db_session, verification_trip):
    trip, stop, event = (
        verification_trip["trip"], verification_trip["stop"], verification_trip["event"],
    )
    verdict = Verdict(
        status=ReceiverVerificationStatus.VERIFIED,
        tier=ReceiverVerificationTier.DOCUMENT_AND_FACE,
    )

    await raise_verification_exception(
        db_session, trip=trip, phase_event_id=event.id, trip_stop_id=stop.id, verdict=verdict,
    )

    rows = await _exception_rows(db_session, trip.id)
    assert rows == []
