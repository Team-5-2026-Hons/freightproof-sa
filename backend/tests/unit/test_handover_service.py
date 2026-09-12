"""FP-236 — capability-token issue and redeem at the service level.

Covers the non-racy branches: unknown token, wrong trip, wrong stop, expired,
already-redeemed, successful redemption, and that every branch logs an attempt row.
The concurrent-redemption race lives in
tests/integration/test_handover_token_concurrency.py, on its own module for the same
reason test_exception_idempotency_concurrency.py is separate from this style of test:
db_session here binds every test to one connection via create_savepoint, so two
sessions drawn from it can never actually race for the same row.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.db.models.enums import (
    HandoverTokenRejectionReason,
    IdvsStatus,
    OrganizationType,
    PhaseType,
    TripStatus,
    VehicleType,
)
from app.db.models.handover import HandoverCapabilityToken, HandoverTokenAttempt
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.orchestration.handover_service import (
    HandoverRedemptionResult,
    issue_capability_token,
    redeem_capability_token,
)


async def _seed(db_session, *, tag: str) -> dict:
    """One operator org, an active trip with one stop, and its confirmation phase event."""
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()

    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RG{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    user = User(id=uuid.uuid4(), organization_id=org.id, email=f"disp-{tag}@test.co.za", full_name="Dispatcher")
    db_session.add_all([driver, horse, origin, dest, user])
    await db_session.flush()

    trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-{tag}", order_number=f"ORD-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=dest.id, sequence=1)
    other_stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=origin.id, sequence=0)
    db_session.add_all([stop, other_stop])
    await db_session.flush()

    phase_event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
    )
    db_session.add(phase_event)
    await db_session.flush()

    other_trip = Trip(
        id=uuid.uuid4(), trip_reference=f"FP-OTHER-{tag}", order_number=f"ORD-OTHER-{tag}",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.ACTIVE, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(other_trip)
    await db_session.flush()

    return {
        "trip_id": trip.id, "stop_id": stop.id, "other_stop_id": other_stop.id,
        "other_trip_id": other_trip.id, "phase_event_id": phase_event.id,
    }


async def _attempt_reasons(db_session, token_id) -> list:
    rows = (
        await db_session.execute(
            select(HandoverTokenAttempt.rejection_reason).where(HandoverTokenAttempt.token_id == token_id)
        )
    ).scalars().all()
    return rows


async def test_redeem_unknown_token_is_rejected_and_logged(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])

    result = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"], raw_token="not-a-real-token",
    )

    assert result == HandoverRedemptionResult(
        success=False, reason=HandoverTokenRejectionReason.UNKNOWN, token_id=None,
    )
    attempt = (
        await db_session.execute(select(HandoverTokenAttempt).where(HandoverTokenAttempt.token_id.is_(None)))
    ).scalar_one()
    assert attempt.rejection_reason == HandoverTokenRejectionReason.UNKNOWN
    assert attempt.presented_trip_id == seed["trip_id"]


async def test_redeem_wrong_trip_is_rejected_and_logged(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])
    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )

    result = await redeem_capability_token(
        db_session, trip_id=seed["other_trip_id"], trip_stop_id=seed["stop_id"], raw_token=raw_token,
    )

    assert result.success is False
    assert result.reason == HandoverTokenRejectionReason.WRONG_TRIP
    assert result.token_id == token.id
    assert HandoverTokenRejectionReason.WRONG_TRIP in await _attempt_reasons(db_session, token.id)


async def test_redeem_wrong_stop_is_rejected_and_logged(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])
    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )

    result = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["other_stop_id"], raw_token=raw_token,
    )

    assert result.success is False
    assert result.reason == HandoverTokenRejectionReason.WRONG_STOP
    assert HandoverTokenRejectionReason.WRONG_STOP in await _attempt_reasons(db_session, token.id)


async def test_redeem_expired_token_is_rejected_and_logged(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])
    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )
    token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()

    result = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"], raw_token=raw_token,
    )

    assert result.success is False
    assert result.reason == HandoverTokenRejectionReason.EXPIRED
    assert HandoverTokenRejectionReason.EXPIRED in await _attempt_reasons(db_session, token.id)


async def test_redeem_already_redeemed_token_is_rejected_and_logged(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])
    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )

    first = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"], raw_token=raw_token,
    )
    second = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"], raw_token=raw_token,
    )

    assert first.success is True
    assert second.success is False
    assert second.reason == HandoverTokenRejectionReason.ALREADY_REDEEMED
    reasons = await _attempt_reasons(db_session, token.id)
    assert reasons.count(None) == 1
    assert reasons.count(HandoverTokenRejectionReason.ALREADY_REDEEMED) == 1


async def test_redeem_success_marks_token_redeemed_and_logs_attempt(db_session):
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])
    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )

    result = await redeem_capability_token(
        db_session, trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"], raw_token=raw_token,
    )

    assert result.success is True
    assert result.reason is None
    assert result.token_id == token.id

    refreshed = (
        await db_session.execute(select(HandoverCapabilityToken).where(HandoverCapabilityToken.id == token.id))
    ).scalar_one()
    assert refreshed.redeemed_at is not None
    assert None in await _attempt_reasons(db_session, token.id)


async def test_issued_token_hash_never_equals_the_raw_token(db_session):
    """The raw token must not be recoverable from the stored row."""
    seed = await _seed(db_session, tag=uuid.uuid4().hex[:8])

    raw_token, token = await issue_capability_token(
        db_session, phase_event_id=seed["phase_event_id"], trip_id=seed["trip_id"], trip_stop_id=seed["stop_id"],
    )

    assert token.token_hash != raw_token
    assert len(token.token_hash) == 64  # SHA-256 hex digest
