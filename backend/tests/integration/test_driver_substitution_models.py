"""FP-83 C1 storage and DB custody derivation, against real PostgreSQL.

Covers the constraints the migration also builds (one pending request per trip, positive
unique sequence, exactly one actor) and proves the SQL helpers agree with the pure
derive_custody on the same rows.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation,
    DriverSubstitutionConfirmationArtifact,
    DriverSubstitutionCorrection,
    DriverSubstitutionNotice,
    DriverSubstitutionOperation,
    DriverSubstitutionRequest,
    LateDriverEvidence,
    LateDriverEvidenceArtifact,
)
from app.db.models.enums import PhaseStatus, PhaseType
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions.access import (
    CompletedCustodyLink,
    CustodyChainError,
    current_driver_id_expression,
    derive_custody,
    get_current_custody,
    participant_driver_ids,
)
from tests.integration._evidence_anchor_world import World, make_artifact, seed_world

_NOW = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)


async def _driver(db: AsyncSession, world: World) -> Driver:
    driver = Driver(
        id=uuid.uuid4(), organization_id=world.org.id, full_name="Cover Driver",
        id_number=str(uuid.uuid4().int)[:13], phone_number="+27821234568",
        license_number=f"DRV-{uuid.uuid4().hex[:8]}",
    )
    db.add(driver)
    await db.flush()
    return driver


def _request(world: World, outgoing: uuid.UUID, incoming: uuid.UUID, *, state: str = "pending") -> DriverSubstitutionRequest:
    return DriverSubstitutionRequest(
        id=uuid.uuid4(), trip_id=world.trip_id, outgoing_driver_id=outgoing, incoming_driver_id=incoming,
        exchange_label="Beaufort West depot", exchange_latitude=-32.35, exchange_longitude=22.58,
        exchange_instructions="Gate 2", expected_at=_NOW, reason="Shift limit", is_planned=True,
        arranged_by_user_id=world.user.id, version=1, state=state,
    )


def _completed(
    world: World, *, sequence: int, outgoing: uuid.UUID, incoming: uuid.UUID,
    previous: uuid.UUID | None, request_id: uuid.UUID | None = None, at: datetime = _NOW,
    completed_by_user: bool = True,
) -> DriverSubstitution:
    return DriverSubstitution(
        id=uuid.uuid4(), trip_id=world.trip_id, original_driver_id=outgoing, substituting_driver_id=incoming,
        exchange_location="Beaufort West depot", approving_dispatcher_user_id=world.user.id,
        is_planned=True, substitution_at=at, sequence_number=sequence, previous_substitution_id=previous,
        request_id=request_id, completed_by_user_id=world.user.id if request_id and completed_by_user else None,
    )


async def _chain(db: AsyncSession, world: World, drivers: list[uuid.UUID]) -> list[DriverSubstitution]:
    """Persist drivers[0] -> drivers[1] -> ... as NEW (request-backed) completed rows."""
    rows: list[DriverSubstitution] = []
    for index in range(1, len(drivers)):
        request = _request(world, drivers[index - 1], drivers[index], state="completed")
        db.add(request)
        await db.flush()
        row = _completed(
            world, sequence=index, outgoing=drivers[index - 1], incoming=drivers[index],
            previous=rows[-1].id if rows else None, request_id=request.id,
            # Identical instants: only sequence_number can order these.
            at=_NOW,
        )
        db.add(row)
        await db.flush()
        rows.append(row)
    return rows


async def _violates(db: AsyncSession, *objects: Any) -> str:
    """Flush objects inside a savepoint and return the integrity error text."""
    try:
        async with db.begin_nested():
            db.add_all(objects)
            await db.flush()
    except IntegrityError as error:
        return str(error)
    raise AssertionError("the database accepted a row it must reject")


# ── custody derivation against the database ──────────────────────────────────


async def test_no_amendments_resolve_the_original_driver(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)

    custody = await get_current_custody(db_session, trip=world.trip)

    assert (custody.driver_id, custody.sequence, custody.substitution_id) == (world.driver_id, 0, None)


async def test_pending_and_cancelled_requests_never_change_custody(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    cancelled = _request(world, world.driver_id, other.id, state="cancelled")
    db_session.add(cancelled)
    await db_session.flush()
    db_session.add(_request(world, world.driver_id, other.id, state="pending"))
    await db_session.flush()

    custody = await get_current_custody(db_session, trip=world.trip)
    expression = (await db_session.execute(
        select(current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id))
        .where(Trip.id == world.trip_id)
    )).scalar_one()

    assert (custody.driver_id, custody.sequence, custody.substitution_id) == (world.driver_id, 0, None)
    assert expression == world.driver_id


async def test_sql_helpers_agree_with_the_pure_derivation_on_a_returning_driver(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    rows = await _chain(db_session, world, [world.driver_id, b.id, c.id, world.driver_id])
    links = [
        CompletedCustodyLink(
            id=r.id, sequence_number=r.sequence_number, previous_substitution_id=r.previous_substitution_id,
            outgoing_driver_id=r.original_driver_id, incoming_driver_id=r.substituting_driver_id,
            effective_at=r.substitution_at,
        )
        for r in rows
    ]

    pure = derive_custody(world.driver_id, links)
    from_db = await get_current_custody(db_session, trip=world.trip)
    expression = (await db_session.execute(
        select(current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id))
        .where(Trip.id == world.trip_id)
    )).scalar_one()

    assert from_db == pure
    assert (pure.driver_id, pure.sequence, pure.substitution_id) == (world.driver_id, 3, rows[2].id)
    assert expression == pure.driver_id
    assert world.trip.driver_id == world.driver_id  # the original lock never moved


async def test_current_driver_expression_is_scoped_per_trip(db_session: AsyncSession) -> None:
    first, second = await seed_world(db_session, tag="A"), await seed_world(db_session, tag="B")
    cover = await _driver(db_session, first)
    await _chain(db_session, first, [first.driver_id, cover.id])

    rows = dict((await db_session.execute(
        select(Trip.id, current_driver_id_expression(trip_id=Trip.id, original_driver_id=Trip.driver_id))
        .where(Trip.id.in_([first.trip_id, second.trip_id]))
    )).tuples().all())

    assert rows == {first.trip_id: cover.id, second.trip_id: second.driver_id}


async def test_participants_are_everyone_who_held_the_trip_and_no_pending_incoming(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c, waiting = [await _driver(db_session, world) for _ in range(3)]
    await _chain(db_session, world, [world.driver_id, b.id, c.id])
    db_session.add(_request(world, c.id, waiting.id))
    await db_session.flush()

    participants = await participant_driver_ids(db_session, trip_id=world.trip_id)

    assert participants == {world.driver_id, b.id, c.id}


async def test_participants_of_an_ordinary_trip_are_its_original_driver(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)

    assert await participant_driver_ids(db_session, trip_id=world.trip_id) == {world.driver_id}
    assert await participant_driver_ids(db_session, trip_id=uuid.uuid4()) == set()


async def test_a_broken_stored_chain_raises_instead_of_resolving(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c, stranger = [await _driver(db_session, world) for _ in range(3)]
    rows = await _chain(db_session, world, [world.driver_id, b.id])
    request = _request(world, stranger.id, c.id, state="completed")
    db_session.add(request)
    await db_session.flush()
    # Link 2's outgoing driver is not link 1's incoming driver.
    db_session.add(_completed(
        world, sequence=2, outgoing=stranger.id, incoming=c.id, previous=rows[0].id, request_id=request.id,
    ))
    await db_session.flush()

    with pytest.raises(CustodyChainError, match="outgoing"):
        await get_current_custody(db_session, trip=world.trip)


# ── constraints ──────────────────────────────────────────────────────────────


async def test_only_one_pending_request_per_trip(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    db_session.add(_request(world, world.driver_id, other.id))
    await db_session.flush()

    error = await _violates(db_session, _request(world, world.driver_id, other.id))

    assert "uq_dsub_requests_one_pending_per_trip" in error


async def test_a_new_pending_request_is_allowed_once_the_old_one_is_cancelled(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    db_session.add_all([
        _request(world, world.driver_id, other.id, state="cancelled"),
        _request(world, world.driver_id, other.id, state="completed"),
        _request(world, world.driver_id, other.id, state="pending"),
    ])

    await db_session.flush()


async def test_request_version_must_be_positive_and_state_known(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    zero_version = _request(world, world.driver_id, other.id)
    zero_version.version = 0
    odd_state = _request(world, world.driver_id, other.id, state="paused")

    assert "ck_dsub_requests_version_positive" in await _violates(db_session, zero_version)
    assert "ck_dsub_requests_state" in await _violates(db_session, odd_state)


async def test_sequence_number_is_positive_and_unique_per_trip(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    (first,) = await _chain(db_session, world, [world.driver_id, b.id])
    request = _request(world, b.id, c.id, state="completed")
    db_session.add(request)
    await db_session.flush()

    duplicate = _completed(world, sequence=1, outgoing=b.id, incoming=c.id, previous=None, request_id=request.id)
    # A non-null previous link keeps ck_..._previous_link satisfied so only positivity is tested.
    zero = _completed(world, sequence=0, outgoing=b.id, incoming=c.id, previous=first.id, request_id=request.id)

    assert "uq_driver_substitutions_trip_sequence" in await _violates(db_session, duplicate)
    assert "ck_driver_substitutions_sequence_positive" in await _violates(db_session, zero)
    assert first.sequence_number == 1


async def test_first_link_has_no_previous_and_later_links_must_have_one(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    (first,) = await _chain(db_session, world, [world.driver_id, b.id])
    request = _request(world, b.id, c.id, state="completed")
    db_session.add(request)
    await db_session.flush()

    headless_second = _completed(world, sequence=2, outgoing=b.id, incoming=c.id, previous=None, request_id=request.id)

    assert "ck_driver_substitutions_previous_link" in await _violates(db_session, headless_second)
    assert first.previous_substitution_id is None


async def test_two_links_cannot_share_a_previous_link(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    (first,) = await _chain(db_session, world, [world.driver_id, b.id])
    request = _request(world, b.id, c.id, state="completed")
    db_session.add(request)
    await db_session.flush()
    db_session.add(_completed(world, sequence=2, outgoing=b.id, incoming=c.id, previous=first.id, request_id=request.id))
    await db_session.flush()
    fork_request = _request(world, b.id, c.id, state="completed")
    db_session.add(fork_request)
    await db_session.flush()

    fork = _completed(world, sequence=3, outgoing=b.id, incoming=c.id, previous=first.id, request_id=fork_request.id)

    assert "uq_driver_substitutions_previous" in await _violates(db_session, fork)


async def test_a_request_completes_into_at_most_one_substitution(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    (first,) = await _chain(db_session, world, [world.driver_id, b.id])

    again = _completed(world, sequence=2, outgoing=b.id, incoming=c.id, previous=first.id, request_id=first.request_id)

    assert "uq_driver_substitutions_request_id" in await _violates(db_session, again)


async def test_legacy_rows_may_share_a_null_request_id(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b, c = await _driver(db_session, world), await _driver(db_session, world)
    first = _completed(world, sequence=1, outgoing=world.driver_id, incoming=b.id, previous=None)
    db_session.add(first)
    await db_session.flush()
    second = _completed(world, sequence=2, outgoing=b.id, incoming=c.id, previous=first.id)
    db_session.add(second)

    await db_session.flush()

    assert first.request_id is None and second.request_id is None
    assert first.completed_by_driver_id is None and first.completed_by_user_id is None


async def test_new_completed_rows_need_exactly_one_completing_actor(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b = await _driver(db_session, world)
    request = _request(world, world.driver_id, b.id, state="completed")
    db_session.add(request)
    await db_session.flush()
    neither = _completed(
        world, sequence=1, outgoing=world.driver_id, incoming=b.id, previous=None,
        request_id=request.id, completed_by_user=False,
    )
    both = _completed(world, sequence=1, outgoing=world.driver_id, incoming=b.id, previous=None, request_id=request.id)
    both.completed_by_driver_id = b.id

    assert "ck_driver_substitutions_completion_actor" in await _violates(db_session, neither)
    assert "ck_driver_substitutions_completion_actor" in await _violates(db_session, both)


async def test_a_driver_can_be_the_completing_actor(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b = await _driver(db_session, world)
    request = _request(world, world.driver_id, b.id, state="completed")
    db_session.add(request)
    await db_session.flush()
    row = _completed(
        world, sequence=1, outgoing=world.driver_id, incoming=b.id, previous=None,
        request_id=request.id, completed_by_user=False,
    )
    row.completed_by_driver_id = b.id
    db_session.add(row)

    await db_session.flush()


async def test_legacy_rows_cannot_carry_an_invented_completing_actor(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    b = await _driver(db_session, world)
    legacy = _completed(world, sequence=1, outgoing=world.driver_id, incoming=b.id, previous=None)
    legacy.completed_by_user_id = world.user.id

    assert "ck_driver_substitutions_completion_actor" in await _violates(db_session, legacy)


async def test_operation_needs_exactly_one_actor(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    key = uuid.uuid4()

    def operation(**actors: uuid.UUID | None) -> DriverSubstitutionOperation:
        return DriverSubstitutionOperation(
            id=uuid.uuid4(), action="arrange", client_request_id=key, body_digest="0" * 64,
            result_json={}, **actors,
        )

    assert "ck_dsub_operations_one_actor" in await _violates(db_session, operation())
    assert "ck_dsub_operations_one_actor" in await _violates(
        db_session, operation(actor_driver_id=world.driver_id, actor_user_id=world.user.id),
    )


async def test_operation_key_is_unique_per_actor_and_action(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    key = uuid.uuid4()

    def by_driver(action: str) -> DriverSubstitutionOperation:
        return DriverSubstitutionOperation(
            id=uuid.uuid4(), actor_driver_id=world.driver_id, action=action, client_request_id=key,
            body_digest="0" * 64, result_json={},
        )

    def by_user(action: str) -> DriverSubstitutionOperation:
        return DriverSubstitutionOperation(
            id=uuid.uuid4(), actor_user_id=world.user.id, action=action, client_request_id=key,
            body_digest="0" * 64, result_json={},
        )

    db_session.add_all([by_driver("confirm"), by_user("confirm"), by_driver("late_evidence")])
    await db_session.flush()

    assert "uq_dsub_operations_driver_action_key" in await _violates(db_session, by_driver("confirm"))
    assert "uq_dsub_operations_user_action_key" in await _violates(db_session, by_user("confirm"))


async def test_notice_is_unique_per_recipient_request_and_kind(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    request = _request(world, world.driver_id, other.id)
    db_session.add(request)
    await db_session.flush()
    db_session.add_all([
        DriverSubstitutionNotice(recipient_driver_id=other.id, request_id=request.id, kind="arranged"),
        DriverSubstitutionNotice(recipient_driver_id=world.driver_id, request_id=request.id, kind="arranged"),
        DriverSubstitutionNotice(recipient_driver_id=other.id, request_id=request.id, kind="cancelled"),
    ])
    await db_session.flush()

    duplicate = DriverSubstitutionNotice(recipient_driver_id=other.id, request_id=request.id, kind="arranged")

    assert "uq_dsub_notices_recipient_request_kind" in await _violates(db_session, duplicate)


async def test_one_confirmation_per_request_and_role_with_nullable_together_location(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    request = _request(world, world.driver_id, other.id)
    db_session.add(request)
    await db_session.flush()

    def confirmation(role: str, **location: float | None) -> DriverSubstitutionConfirmation:
        return DriverSubstitutionConfirmation(
            request_id=request.id, role=role, driver_id=world.driver_id, captured_at=_NOW,
            received_at=_NOW + timedelta(seconds=5), confirmed_vehicle_ids=[], seal_checks=[], **location,
        )

    db_session.add_all([confirmation("outgoing"), confirmation("incoming", latitude=1.0, longitude=2.0, accuracy_metres=5.0)])
    await db_session.flush()

    assert "uq_dsub_confirmations_request_role" in await _violates(db_session, confirmation("outgoing"))
    partial = confirmation("incoming", latitude=1.0)
    partial.request_id = request.id
    assert "ck_dsub_confirmations_location_together" in await _violates(db_session, partial)


async def test_confirmation_artifacts_late_evidence_and_corrections_store(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    request = _request(world, world.driver_id, other.id)
    db_session.add(request)
    await db_session.flush()
    confirmation = DriverSubstitutionConfirmation(
        request_id=request.id, role="outgoing", driver_id=world.driver_id, captured_at=_NOW,
        received_at=_NOW, confirmed_vehicle_ids=[], seal_checks=[],
    )
    artifact = await make_artifact(db_session, world.trip_id)
    db_session.add(confirmation)
    await db_session.flush()
    evidence = LateDriverEvidence(
        trip_id=world.trip_id, driver_id=world.driver_id, custody_sequence=0, kind="phase",
        evidence_json={"kind": "phase"}, payload_sha256="a" * 64, captured_at=_NOW, received_at=_NOW,
    )
    db_session.add(evidence)
    await db_session.flush()
    (substitution,) = await _chain(db_session, world, [world.driver_id, other.id])

    db_session.add_all([
        DriverSubstitutionConfirmationArtifact(
            confirmation_id=confirmation.id, artifact_id=artifact.id, vehicle_id=world.trip.horse_id, position=0,
        ),
        LateDriverEvidenceArtifact(late_evidence_id=evidence.id, artifact_id=artifact.id, position=0),
        DriverSubstitutionCorrection(
            substitution_id=substitution.id, recorded_by_user_id=world.user.id, reason="Typo in point name",
            correction_note="Depot is Beaufort West", payload_version=1, payload_json={}, event_hash="b" * 64,
        ),
    ])
    await db_session.flush()

    assert evidence.status == "awaiting_review"
    created = [confirmation.created_at, confirmation.updated_at, request.created_at, request.updated_at]
    assert all(value is not None for value in created)


async def test_a_correction_cannot_claim_an_anchor_without_a_receipt(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    other = await _driver(db_session, world)
    (substitution,) = await _chain(db_session, world, [world.driver_id, other.id])
    correction = DriverSubstitutionCorrection(
        substitution_id=substitution.id, recorded_by_user_id=world.user.id, reason="r", correction_note="n",
        payload_version=1, payload_json={}, event_hash="b" * 64, anchor_status="anchored",
    )

    assert "ck_dsub_corrections_anchored_has_receipt" in await _violates(db_session, correction)


# ── new actor columns on existing tables ─────────────────────────────────────


async def test_phase_events_and_exceptions_carry_nullable_actor_and_sequence(db_session: AsyncSession) -> None:
    world = await seed_world(db_session)
    phase = PhaseEvent(
        trip_id=world.trip_id, phase_type=PhaseType.TRIP_CREATION, sequence_number=0, status=PhaseStatus.PENDING,
    )
    db_session.add(phase)
    await db_session.flush()

    assert phase.performed_by_driver_id is None and phase.custody_sequence is None

    phase.performed_by_driver_id, phase.custody_sequence = world.driver_id, 2
    await db_session.flush()

    assert (phase.performed_by_driver_id, phase.custody_sequence) == (world.driver_id, 2)


async def test_exceptions_carry_nullable_actor_and_sequence(db_session: AsyncSession) -> None:
    from app.db.models.enums import ExceptionSeverity, ExceptionSource, ExceptionType
    from app.db.models.transit import TripException

    world = await seed_world(db_session)
    exception = TripException(
        trip_id=world.trip_id, exception_type=ExceptionType.PANIC_BUTTON, source=ExceptionSource.DRIVER,
        severity=ExceptionSeverity.CRITICAL, description="x",
    )
    db_session.add(exception)
    await db_session.flush()

    assert exception.performed_by_driver_id is None and exception.custody_sequence is None

    exception.performed_by_driver_id, exception.custody_sequence = world.driver_id, 1
    await db_session.flush()

    assert (exception.performed_by_driver_id, exception.custody_sequence) == (world.driver_id, 1)
