"""FP-83 C3: the handover lifecycle service (arrange, cancel, replace, confirm, complete, ...).

These run on the rolled-back `db_session`: the service never commits (the request's get_db does),
so one shared transaction is exactly what its callers see. Where a lock must actually be waited
on, see test_driver_substitution_concurrency.py.

The clock is a patched `service.utcnow` so licence and availability rules are asserted at exact
SAST instants rather than "now-ish".
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import Table, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    IdempotencyKeyReusedError, IdentityAttestationForbiddenError, IdentityNotVerifiedError,
    IncomingDriverInactiveError, IncomingDriverUnavailableError, LicenceInvalidError, ResourceNotFoundError,
    SubstitutionInvalidError, SubstitutionNotPendingError, SubstitutionVersionChangedError, TripStateError,
)
from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionNotice,
    DriverSubstitutionRequest, DriverSubstitutionUpload,
)
from app.db.models.enums import ArtifactType, DispatcherRole, IdvsStatus, PhaseType, TripStatus, TripType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.people import Driver
from app.db.models.phases import PhaseEvent
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions.access import get_current_custody
from app.orchestration.substitutions import service
from app.orchestration.substitutions.service import (
    arrange_substitution, cancel_substitution, complete_attested_substitution, confirm_substitution,
    correct_completed_substitution, replace_substitution,
)
from app.orchestration.substitutions.termination import cancel_pending_for_terminal_trip
from app.orchestration.trips.availability import CrewFilter, TimeWindow, busy_crew_in_window
from app.schemas.driver_substitutions import (
    ArrangeSubstitutionRequest, CancelSubstitutionRequest, CompleteSubstitutionRequest, ConfirmSubstitutionRequest,
    CorrectSubstitutionRequest, ExchangePoint, ReplaceSubstitutionRequest, SealCheck, SubstitutionAction, SubstitutionCompletionBlocker,
    SubstitutionCompletionMode, SubstitutionCompletionTrigger, SubstitutionNoticeKind, SubstitutionRequestRead,
    SubstitutionRole, SubstitutionSealCondition, SubstitutionState,
)
from app.schemas.people import DriverRead, UserRead
from tests.integration._driver_substitution_world import SubWorld, add_trip, build_world

# 10:00 SAST on a Monday. Everything below is relative to this fixed "now".
NOW = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)
VALID_LICENCE = date(2027, 1, 1)


class Clock:
    """The service's clock; a test moves `now` to cross an exact SAST boundary."""

    now = NOW


@pytest.fixture(autouse=True)
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    fixed = Clock()
    monkeypatch.setattr(service, "utcnow", lambda: fixed.now)
    return fixed


def dispatcher(w: SubWorld, *, admin: bool = False, organization_id: uuid.UUID | None = None,
               user_id: uuid.UUID | None = None) -> UserRead:
    return UserRead(
        id=user_id or w.user_id, organization_id=organization_id or w.org_id, email="d@test.co.za",
        full_name="Dispatcher", created_at=NOW, updated_at=NOW,
        role=DispatcherRole.ADMIN_DISPATCHER if admin else DispatcherRole.DISPATCHER,
    )


def arrangement(w: SubWorld, *, incoming: uuid.UUID | None = None, expected_at: datetime | None = None,
                key: uuid.UUID | None = None, reason: str = "Hours of service") -> ArrangeSubstitutionRequest:
    return ArrangeSubstitutionRequest(
        client_request_id=key or uuid.uuid4(), incoming_driver_id=incoming or w.b,
        exchange=ExchangePoint(label="Beaufort West depot", latitude=-32.35, longitude=22.58, instructions="Gate 2"),
        expected_at=expected_at or NOW + 2 * HOUR, is_planned=True, reason=reason,
    )


async def get_row[T](db: AsyncSession, model: type[T], pk: uuid.UUID) -> T:
    """`db.get` that fails loudly on a missing row, so tests can use the row without Optional narrowing."""
    row = await db.get(model, pk)
    assert row is not None, f"{model.__name__} {pk} not found"
    return row


async def world_with_licences(db: AsyncSession, **kwargs) -> SubWorld:
    """A live trip under A, with valid licences on B and C so only the case under test fails."""
    w = await build_world(db, departure=NOW, arrival=NOW + 8 * HOUR, **kwargs)
    for driver_id in (w.a, w.b, w.c):
        (await get_row(db, Driver, driver_id)).license_expiry = VALID_LICENCE
    await db.flush()
    return w


async def count(db: AsyncSession, model, *where) -> int:
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def notice_kinds(db: AsyncSession, request_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
    rows = await db.execute(
        select(DriverSubstitutionNotice.recipient_driver_id, DriverSubstitutionNotice.kind)
        .where(DriverSubstitutionNotice.request_id == request_id)
    )
    kinds: dict[uuid.UUID, list[str]] = {}
    for driver_id, kind in rows:
        kinds.setdefault(driver_id, []).append(kind)
    return kinds


async def trip_fingerprint(db: AsyncSession, w: SubWorld) -> tuple:
    """What a handover must never touch: trip id, original driver, and the phase sequence."""
    trip = await get_row(db, Trip, w.trip_id)
    await db.refresh(trip)
    phases = (await db.execute(
        select(PhaseEvent.sequence_number, PhaseEvent.phase_type, PhaseEvent.status)
        .where(PhaseEvent.trip_id == w.trip_id).order_by(PhaseEvent.sequence_number)
    )).all()
    return trip.id, trip.driver_id, [tuple(p) for p in phases]


# ── arrange ──────────────────────────────────────────────────────────────────


async def test_arrange_creates_one_pending_request_and_notifies_both_drivers(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    before = await trip_fingerprint(db_session, w)

    read = await arrange_substitution(
        db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w),
    )

    assert read.state is SubstitutionState.PENDING
    assert read.version == 1
    assert (read.outgoing.id, read.incoming.id) == (w.a, w.b)
    assert read.missing_confirmations == [SubstitutionRole.OUTGOING, SubstitutionRole.INCOMING]
    assert read.confirmations == [] and read.completion_blocked_by is None
    assert SubstitutionAction.CANCEL in read.permitted_actions
    stored = await get_row(db_session, DriverSubstitutionRequest, read.id)
    assert stored.arranged_by_user_id == w.user_id and stored.version == 1
    assert await notice_kinds(db_session, read.id) == {
        w.a: [SubstitutionNoticeKind.ARRANGED.value], w.b: [SubstitutionNoticeKind.ARRANGED.value],
    }
    assert await trip_fingerprint(db_session, w) == before


async def test_arrange_rollback_leaves_no_request_and_no_notice(db_session: AsyncSession):
    w = await world_with_licences(db_session)

    with pytest.raises(RuntimeError):
        async with db_session.begin_nested():
            await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
            raise RuntimeError("fail after the service returned")

    assert await count(db_session, DriverSubstitutionRequest, DriverSubstitutionRequest.trip_id == w.trip_id) == 0
    assert await count(db_session, DriverSubstitutionNotice) == 0


async def test_arrange_exact_replay_returns_the_same_request_without_a_second_side_effect(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    payload = arrangement(w)

    first = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=payload)
    replay = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=payload)

    assert replay == first
    assert await count(db_session, DriverSubstitutionRequest, DriverSubstitutionRequest.trip_id == w.trip_id) == 1
    assert await count(db_session, DriverSubstitutionNotice) == 2


async def test_arrange_reusing_a_key_with_a_different_body_is_refused(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    key = uuid.uuid4()
    await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, key=key))

    with pytest.raises(IdempotencyKeyReusedError):
        await arrange_substitution(
            db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, key=key, reason="Different"),
        )


async def test_arrange_key_is_scoped_to_the_actor(db_session: AsyncSession):
    """Another dispatcher reusing the same UUID is a fresh action, not a replay of the first."""
    w = await world_with_licences(db_session)
    key = uuid.uuid4()
    first = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, key=key))
    await cancel_substitution(
        db_session, trip_id=w.trip_id, request_id=first.id, actor=dispatcher(w),
        payload=CancelSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=1, reason="Changed plan"),
    )

    colleague = dispatcher(w, user_id=await _second_dispatcher(db_session, w))
    second = await arrange_substitution(db_session, trip_id=w.trip_id, actor=colleague, payload=arrangement(w, key=key))

    assert second.id != first.id


async def _second_dispatcher(db: AsyncSession, w: SubWorld) -> uuid.UUID:
    from app.db.models.people import User

    user = User(id=uuid.uuid4(), organization_id=w.org_id, email=f"{uuid.uuid4()}@test.co.za", full_name="Second")
    db.add(user)
    await db.flush()
    return user.id


async def test_another_organisations_dispatcher_cannot_arrange(db_session: AsyncSession):
    w = await world_with_licences(db_session)

    with pytest.raises(ResourceNotFoundError):
        await arrange_substitution(
            db_session, trip_id=w.trip_id, actor=dispatcher(w, organization_id=w.other_org_id), payload=arrangement(w),
        )

    assert await count(db_session, DriverSubstitutionRequest) == 0


async def test_an_incoming_driver_from_another_organisation_is_not_found(db_session: AsyncSession):
    w = await world_with_licences(db_session)

    with pytest.raises(ResourceNotFoundError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=w.d))


async def test_the_current_driver_cannot_be_arranged_as_their_own_replacement(db_session: AsyncSession):
    w = await world_with_licences(db_session)

    with pytest.raises(SubstitutionInvalidError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=w.a))


@pytest.mark.parametrize("status", [TripStatus.CREATED, TripStatus.CLOSED, TripStatus.CANCELLED])
async def test_arrange_refuses_a_trip_that_is_not_live(db_session: AsyncSession, status: TripStatus):
    """CREATED is the unresolved-activation case: a handover must not interleave with activation."""
    w = await world_with_licences(db_session, status=status)

    with pytest.raises(TripStateError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    assert await count(db_session, DriverSubstitutionRequest) == 0


async def test_arrange_is_allowed_on_a_trip_held_for_an_exception(db_session: AsyncSession):
    w = await world_with_licences(db_session, status=TripStatus.EXCEPTION_HOLD)

    read = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    assert read.state is SubstitutionState.PENDING
    assert (await get_row(db_session, Trip, w.trip_id)).status == TripStatus.EXCEPTION_HOLD


async def test_a_second_arrangement_is_refused_while_one_is_pending(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    first = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    with pytest.raises(SubstitutionVersionChangedError) as refused:
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=w.c))

    assert refused.value.request_id == first.id and refused.value.current_version == 1


# Licence rule at arrangement: valid through the end of the expiry date in SAST.
# 21:30 UTC is 23:30 SAST; 22:30 UTC is 00:30 SAST the next day.
LICENCE_DAY = date(2026, 10, 25)
SAST_LATE_EVENING = datetime(2026, 10, 25, 21, 30, tzinfo=UTC)
SAST_PAST_MIDNIGHT = datetime(2026, 10, 25, 22, 30, tzinfo=UTC)


@pytest.mark.parametrize(("expiry", "expected_at", "valid"), [
    (None, NOW + 2 * HOUR, False),
    (date(2026, 10, 18), NOW + 2 * HOUR, False),
    (LICENCE_DAY, SAST_LATE_EVENING, True),
    (LICENCE_DAY, SAST_PAST_MIDNIGHT, False),
])
async def test_arrange_checks_the_licence_against_the_expected_sast_date(
    db_session: AsyncSession, expiry: date | None, expected_at: datetime, valid: bool,
):
    w = await world_with_licences(db_session)
    (await get_row(db_session, Driver, w.b)).license_expiry = expiry
    await db_session.flush()

    attempt = arrange_substitution(
        db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, expected_at=expected_at),
    )
    if valid:
        assert (await attempt).state is SubstitutionState.PENDING
    else:
        with pytest.raises(LicenceInvalidError):
            await attempt
        assert await count(db_session, DriverSubstitutionRequest) == 0


async def test_arrange_refuses_an_inactive_incoming_driver(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    (await get_row(db_session, Driver, w.b)).is_active = False
    await db_session.flush()

    with pytest.raises(IncomingDriverInactiveError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))


async def test_arrange_reports_inactive_before_licence(db_session: AsyncSession):
    """Fixed precedence: inactive, licence, availability."""
    w = await world_with_licences(db_session)
    driver = await get_row(db_session, Driver, w.b)
    driver.is_active, driver.license_expiry = False, None
    await db_session.flush()

    with pytest.raises(IncomingDriverInactiveError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))


async def test_arrange_refuses_an_incoming_driver_who_is_busy_on_another_trip(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    await add_trip(db_session, w, driver_id=w.b, status=TripStatus.ACTIVE, departure=NOW, arrival=None)

    with pytest.raises(IncomingDriverUnavailableError):
        await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    assert await count(db_session, DriverSubstitutionRequest) == 0


async def test_arrange_accepts_an_incoming_driver_with_pending_identity(db_session: AsyncSession):
    """Identity is decided at completion; an arrangement is saved with the truthful status."""
    w = await world_with_licences(db_session)

    read = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    assert read.identity.status.value == "pending"
    assert read.identity.driver_id == w.b


# ── cancel ───────────────────────────────────────────────────────────────────


def cancel_body(version: int = 1, key: uuid.UUID | None = None) -> CancelSubstitutionRequest:
    return CancelSubstitutionRequest(client_request_id=key or uuid.uuid4(), expected_version=version, reason="No longer needed")


async def test_cancel_ends_the_request_releases_the_reservation_and_notifies_both_drivers(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    before = await trip_fingerprint(db_session, w)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    window = TimeWindow(NOW + 2 * HOUR, NOW + 3 * HOUR)
    crew = CrewFilter(driver_id=w.b)
    assert await busy_crew_in_window(db_session, organization_id=w.org_id, window=window, now=NOW, crew=crew)

    read = await cancel_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=cancel_body(),
    )

    assert read.state is SubstitutionState.CANCELLED and read.version == 2
    assert read.permitted_actions == []
    assert await busy_crew_in_window(db_session, organization_id=w.org_id, window=window, now=NOW, crew=crew) == []
    kinds = await notice_kinds(db_session, pending.id)
    assert sorted(kinds[w.a]) == ["arranged", "cancelled"] and sorted(kinds[w.b]) == ["arranged", "cancelled"]
    stored = await get_row(db_session, DriverSubstitutionRequest, pending.id)
    assert stored.terminal_reason == "No longer needed" and stored.terminal_at == NOW
    assert await trip_fingerprint(db_session, w) == before


async def test_cancel_with_a_stale_version_is_refused_and_changes_nothing(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    with pytest.raises(SubstitutionVersionChangedError) as refused:
        await cancel_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=cancel_body(version=7),
        )

    assert refused.value.current_version == 1
    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).state == "pending"


async def test_cancel_replay_returns_the_original_result_even_though_the_version_moved(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    body = cancel_body()

    first = await cancel_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=body)
    replay = await cancel_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=body)

    assert replay == first
    assert await count(db_session, DriverSubstitutionNotice, DriverSubstitutionNotice.kind == "cancelled") == 2


async def test_cancelling_a_request_that_is_already_cancelled_is_refused(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    await cancel_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=cancel_body())

    with pytest.raises(SubstitutionNotPendingError):
        await cancel_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=cancel_body(version=2),
        )


async def test_another_organisation_cannot_cancel(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    with pytest.raises(ResourceNotFoundError):
        await cancel_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id,
            actor=dispatcher(w, organization_id=w.other_org_id), payload=cancel_body(),
        )

    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).state == "pending"


# ── replace ──────────────────────────────────────────────────────────────────


def replace_body(w: SubWorld, *, version: int = 1, incoming: uuid.UUID | None = None, key: uuid.UUID | None = None,
                 expected_at: datetime | None = None) -> ReplaceSubstitutionRequest:
    base = arrangement(w, incoming=incoming or w.c, expected_at=expected_at, reason="Driver C is closer")
    return ReplaceSubstitutionRequest(
        client_request_id=key or uuid.uuid4(), expected_version=version, replacement_reason="Wrong driver chosen",
        **base.model_dump(exclude={"client_request_id"}),
    )


async def test_replace_cancels_the_old_request_and_creates_a_fresh_one(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    before = await trip_fingerprint(db_session, w)
    old = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    cancelled = await replace_substitution(
        db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=replace_body(w),
    )

    assert cancelled.state is SubstitutionState.CANCELLED and cancelled.id == old.id
    new_id = cancelled.replacement_request_id
    assert new_id is not None and new_id != old.id
    new = await get_row(db_session, DriverSubstitutionRequest, new_id)
    assert (new.state, new.version, new.incoming_driver_id) == ("pending", 1, w.c)
    assert new.reason == "Driver C is closer"
    assert await count(db_session, DriverSubstitutionRequest, DriverSubstitutionRequest.state == "pending") == 1
    assert sorted((await notice_kinds(db_session, old.id))[w.b]) == ["arranged", "cancelled"]
    assert (await notice_kinds(db_session, new_id)) == {w.a: ["arranged"], w.c: ["arranged"]}
    assert await trip_fingerprint(db_session, w) == before


async def test_replacement_starts_with_no_inherited_confirmations(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    old = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    cancelled = await replace_substitution(
        db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=replace_body(w),
    )

    from app.db.models.driver_substitutions import DriverSubstitutionConfirmation

    assert await count(
        db_session, DriverSubstitutionConfirmation, DriverSubstitutionConfirmation.request_id == cancelled.replacement_request_id,
    ) == 0


async def test_replace_replay_resolves_to_the_same_new_request(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    old = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    body = replace_body(w)

    first = await replace_substitution(db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=body)
    replay = await replace_substitution(db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=body)

    assert replay.replacement_request_id == first.replacement_request_id
    assert await count(db_session, DriverSubstitutionRequest, DriverSubstitutionRequest.trip_id == w.trip_id) == 2


async def test_replace_with_an_ineligible_driver_leaves_the_old_request_pending(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    old = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    (await get_row(db_session, Driver, w.c)).license_expiry = None
    await db_session.flush()

    with pytest.raises(LicenceInvalidError):
        await replace_substitution(
            db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=replace_body(w),
        )

    stored = await get_row(db_session, DriverSubstitutionRequest, old.id)
    assert stored.state == "pending" and stored.replacement_request_id is None
    assert await count(db_session, DriverSubstitutionRequest) == 1


async def test_replace_with_a_stale_version_is_refused(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    old = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))

    with pytest.raises(SubstitutionVersionChangedError):
        await replace_substitution(
            db_session, trip_id=w.trip_id, request_id=old.id, actor=dispatcher(w), payload=replace_body(w, version=3),
        )

    assert await count(db_session, DriverSubstitutionRequest) == 1


# ── confirm and complete (CP2) ───────────────────────────────────────────────

CAPTURED_AT = NOW - timedelta(minutes=10)


async def driver_actor(db: AsyncSession, driver_id: uuid.UUID) -> DriverRead:
    driver = await get_row(db, Driver, driver_id)
    await db.refresh(driver)
    return DriverRead.model_validate(driver)


async def set_identity(db: AsyncSession, driver_id: uuid.UUID, status: IdvsStatus) -> None:
    (await get_row(db, Driver, driver_id)).idvs_status = status
    await db.flush()


async def armed(db: AsyncSession, *, identity: IdvsStatus = IdvsStatus.VERIFIED) -> tuple[SubWorld, SubstitutionRequestRead]:
    """A live trip under A with a pending A -> B arrangement and B's identity as given."""
    w = await world_with_licences(db)
    await set_identity(db, w.b, identity)
    return w, await arrange_substitution(db, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))


def capture(w: SubWorld, version: int, *, key: uuid.UUID | None = None,
            vehicles: list[uuid.UUID] | None = None, seal_checks: list[SealCheck] | None = None,
            note: str | None = None) -> ConfirmSubstitutionRequest:
    """A valid empty-leg capture: one vehicle, no seal to read."""
    return ConfirmSubstitutionRequest(
        client_request_id=key or uuid.uuid4(), expected_version=version, captured_at=CAPTURED_AT,
        latitude=-32.35, longitude=22.58, accuracy_metres=8.0,
        confirmed_vehicle_ids=vehicles or [w.horse_id],
        seal_checks=seal_checks if seal_checks is not None else [SealCheck(
            vehicle_id=w.horse_id, condition=SubstitutionSealCondition.NOT_APPLICABLE,
            not_applicable_reason="Empty leg, nothing sealed",
        )],
        discrepancy_note=note,
    )


async def confirm(db: AsyncSession, w: SubWorld, read: SubstitutionRequestRead, driver_id: uuid.UUID,
                  **kwargs) -> SubstitutionRequestRead:
    return await confirm_substitution(
        db, trip_id=w.trip_id, request_id=read.id, actor=await driver_actor(db, driver_id),
        payload=capture(w, kwargs.pop("version", read.version), **kwargs),
    )


def completion(version: int, *, missing: str | None = None, identity: str | None = None,
               declared: datetime | None = None, key: uuid.UUID | None = None) -> CompleteSubstitutionRequest:
    return CompleteSubstitutionRequest(
        client_request_id=key or uuid.uuid4(), expected_version=version, missing_confirmation_reason=missing,
        identity_unavailable_reason=identity, declared_exchange_at=declared,
    )


async def both_confirmed(db: AsyncSession, w: SubWorld, read: SubstitutionRequestRead) -> SubstitutionRequestRead:
    first = await confirm(db, w, read, w.a)
    return await confirm(db, w, first, w.b)


async def chain(db: AsyncSession, trip_id: uuid.UUID) -> list[DriverSubstitution]:
    return list((await db.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == trip_id).order_by(DriverSubstitution.sequence_number)
    )).scalars())


async def test_first_confirmation_saves_the_capture_and_leaves_the_request_pending(db_session: AsyncSession):
    w, pending = await armed(db_session)
    before = await trip_fingerprint(db_session, w)

    read = await confirm(db_session, w, pending, w.a, note="Left a spare strap")

    assert read.state is SubstitutionState.PENDING and read.version == 2
    assert read.missing_confirmations == [SubstitutionRole.INCOMING]
    assert [(c.role, c.driver_id) for c in read.confirmations] == [(SubstitutionRole.OUTGOING, w.a)]
    saved = (await db_session.execute(select(DriverSubstitutionConfirmation))).scalar_one()
    assert saved.captured_at == CAPTURED_AT and saved.received_at == NOW
    assert saved.latitude is not None
    assert (saved.discrepancy_note, float(saved.latitude)) == ("Left a spare strap", -32.35)
    assert await chain(db_session, w.trip_id) == []
    assert (await get_current_custody(db_session, trip=await get_row(db_session, Trip, w.trip_id))).driver_id == w.a
    assert await trip_fingerprint(db_session, w) == before


async def test_a_capture_without_a_position_keeps_the_absence(db_session: AsyncSession):
    w, pending = await armed(db_session)
    body = capture(w, 1).model_copy(update={"latitude": None, "longitude": None, "accuracy_metres": None})

    await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.a), payload=body,
    )

    saved = (await db_session.execute(select(DriverSubstitutionConfirmation))).scalar_one()
    assert (saved.latitude, saved.longitude, saved.accuracy_metres) == (None, None, None)


async def test_the_final_confirmation_completes_the_handover_and_moves_custody(db_session: AsyncSession):
    w, pending = await armed(db_session)
    before = await trip_fingerprint(db_session, w)

    read = await both_confirmed(db_session, w, pending)

    assert read.state is SubstitutionState.COMPLETED and read.version == 3
    assert read.completion_mode is SubstitutionCompletionMode.NORMAL
    assert read.completion is not None
    assert read.completion.trigger is SubstitutionCompletionTrigger.DRIVER_CONFIRMATION
    assert (read.completion.completed_by_driver_id, read.completion.completed_by_user_id) == (w.b, None)
    assert read.completion_blocked_by is None and read.permitted_actions == []
    [row] = await chain(db_session, w.trip_id)
    assert read.completed_substitution_id == row.id and read.effective_at == NOW
    assert (row.sequence_number, row.previous_substitution_id) == (1, None)
    assert (row.original_driver_id, row.substituting_driver_id) == (w.a, w.b)
    assert (row.substitution_at, row.declared_exchange_at, row.exception_id) == (NOW, None, None)
    assert row.approving_dispatcher_user_id == w.user_id
    assert (row.completed_by_driver_id, row.completed_by_user_id, row.completion_mode) == (w.b, None, "normal")
    assert (row.incoming_identity_status, row.identity_attested_by_user_id) == ("verified", None)
    assert (row.incoming_licence_expiry, row.eligibility_observed_at) == (VALID_LICENCE, NOW)
    custody = await get_current_custody(db_session, trip=await get_row(db_session, Trip, w.trip_id))
    assert (custody.driver_id, custody.sequence, custody.substitution_id) == (w.b, 1, row.id)
    assert (await get_row(db_session, Trip, w.trip_id)).driver_id == w.a
    assert await trip_fingerprint(db_session, w) == before
    assert sorted((await notice_kinds(db_session, pending.id))[w.a]) == ["arranged", "completed"]


async def test_completion_releases_the_outgoing_driver_and_occupies_the_incoming_one(db_session: AsyncSession):
    w, pending = await armed(db_session)
    await both_confirmed(db_session, w, pending)
    window = TimeWindow(NOW + HOUR, NOW + 2 * HOUR)

    a_busy = await busy_crew_in_window(db_session, organization_id=w.org_id, window=window, now=NOW, crew=CrewFilter(driver_id=w.a))
    b_busy = await busy_crew_in_window(db_session, organization_id=w.org_id, window=window, now=NOW, crew=CrewFilter(driver_id=w.b))

    assert a_busy == [] and [entry.resource_id for entry in b_busy] == [w.b]


async def test_each_role_can_capture_only_once(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)

    with pytest.raises(SubstitutionVersionChangedError):
        await confirm(db_session, w, first, w.a)

    assert await count(db_session, DriverSubstitutionConfirmation) == 1


async def test_confirm_replay_returns_the_original_result_after_the_request_moved_on(db_session: AsyncSession):
    w, pending = await armed(db_session)
    body = capture(w, 1)
    actor = await driver_actor(db_session, w.a)
    first = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=actor, payload=body)
    await confirm(db_session, w, first, w.b)

    replay = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=actor, payload=body)

    assert replay == first and replay.state is SubstitutionState.PENDING
    assert await count(db_session, DriverSubstitutionConfirmation) == 2


async def test_confirm_reusing_a_key_with_a_different_body_is_refused(db_session: AsyncSession):
    w, pending = await armed(db_session)
    key = uuid.uuid4()
    await confirm(db_session, w, pending, w.a, key=key)

    with pytest.raises(IdempotencyKeyReusedError):
        await confirm(db_session, w, pending, w.a, key=key, note="changed my mind")


async def test_confirm_with_a_stale_version_is_refused(db_session: AsyncSession):
    w, pending = await armed(db_session)

    with pytest.raises(SubstitutionVersionChangedError) as refused:
        await confirm(db_session, w, pending, w.a, version=5)

    assert refused.value.current_version == 1 and await count(db_session, DriverSubstitutionConfirmation) == 0


async def test_confirm_on_a_cancelled_request_is_refused(db_session: AsyncSession):
    w, pending = await armed(db_session)
    await cancel_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=cancel_body())

    with pytest.raises(SubstitutionNotPendingError):
        await confirm(db_session, w, pending, w.a, version=2)


@pytest.mark.parametrize("stranger", ["c", "d"])
async def test_only_the_two_named_drivers_can_confirm(db_session: AsyncSession, stranger: str):
    w, pending = await armed(db_session)

    with pytest.raises(ResourceNotFoundError):
        await confirm(db_session, w, pending, getattr(w, stranger))

    assert await count(db_session, DriverSubstitutionConfirmation) == 0


async def test_a_capture_must_cover_exactly_the_trips_vehicles(db_session: AsyncSession):
    w, pending = await armed(db_session)

    with pytest.raises(SubstitutionInvalidError):
        await confirm(db_session, w, pending, w.a, vehicles=[w.horse_id, uuid.uuid4()])
    with pytest.raises(SubstitutionInvalidError):
        await confirm(db_session, w, pending, w.a, seal_checks=[SealCheck(
            vehicle_id=uuid.uuid4(), condition=SubstitutionSealCondition.NOT_APPLICABLE, not_applicable_reason="x",
        )])

    assert await count(db_session, DriverSubstitutionConfirmation) == 0


async def _photo(db: AsyncSession, w: SubWorld, *, driver_id: uuid.UUID, request_id: uuid.UUID) -> uuid.UUID:
    """A photo the driver uploaded through the handover route for their side of `request_id`
    (A is outgoing, anyone else incoming, as `armed` arranges), seeded straight to the tables."""
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=w.trip_id, artifact_type=ArtifactType.PHOTO.value, s3_key=f"k/{uuid.uuid4()}",
        s3_bucket="b", file_hash=uuid.uuid4().hex + uuid.uuid4().hex, mime_type="image/jpeg",
        captured_by_driver_id=driver_id, captured_at=CAPTURED_AT,
    )
    db.add(artifact)
    await db.flush()
    db.add(DriverSubstitutionUpload(
        artifact_id=artifact.id, trip_id=w.trip_id, driver_id=driver_id, purpose="handover", request_id=request_id,
        role=(SubstitutionRole.OUTGOING if driver_id == w.a else SubstitutionRole.INCOMING).value,
    ))
    await db.flush()
    return artifact.id


def _seal(w: SubWorld, photo: uuid.UUID) -> list[SealCheck]:
    return [SealCheck(
        vehicle_id=w.horse_id, condition=SubstitutionSealCondition.INTACT, seal_number="AB-1234", photo_artifact_ids=[photo],
    )]


async def test_a_loaded_trip_needs_a_real_seal_and_only_the_drivers_own_photo(db_session: AsyncSession):
    w, pending = await armed(db_session)
    (await get_row(db_session, Trip, w.trip_id)).trip_type = TripType.LOADED.value
    await db_session.flush()
    others_photo = await _photo(db_session, w, driver_id=w.b, request_id=pending.id)
    own_photo = await _photo(db_session, w, driver_id=w.a, request_id=pending.id)

    with pytest.raises(SubstitutionInvalidError):  # an empty-leg answer on a loaded trip
        await confirm(db_session, w, pending, w.a)
    with pytest.raises(SubstitutionInvalidError):  # another driver's photo
        await confirm(db_session, w, pending, w.a, seal_checks=_seal(w, others_photo))

    read = await confirm(db_session, w, pending, w.a, seal_checks=_seal(w, own_photo))

    assert read.missing_confirmations == [SubstitutionRole.INCOMING]
    link = (await db_session.execute(select(DriverSubstitutionConfirmationArtifact))).scalar_one()
    assert (link.artifact_id, link.vehicle_id, link.position) == (own_photo, w.horse_id, 0)


async def test_a_loaded_trip_before_departure_accepts_not_applicable(db_session: AsyncSession):
    w, pending = await armed(db_session)
    trip = await get_row(db_session, Trip, w.trip_id)
    trip.trip_type, trip.current_phase = TripType.LOADED.value, PhaseType.LOADING.value
    await db_session.flush()

    read = await confirm(db_session, w, pending, w.a)

    assert read.missing_confirmations == [SubstitutionRole.INCOMING]


async def test_a_loaded_trip_in_transit_still_rejects_not_applicable(db_session: AsyncSession):
    w, pending = await armed(db_session)
    trip = await get_row(db_session, Trip, w.trip_id)
    trip.trip_type, trip.current_phase = TripType.LOADED.value, PhaseType.IN_TRANSIT.value
    await db_session.flush()

    with pytest.raises(SubstitutionInvalidError, match="once it has departed"):
        await confirm(db_session, w, pending, w.a)

    assert await count(db_session, DriverSubstitutionConfirmationArtifact) == 0


async def test_a_photo_cannot_support_two_captures(db_session: AsyncSession):
    w, pending = await armed(db_session)
    (await get_row(db_session, Trip, w.trip_id)).trip_type = TripType.LOADED.value
    photo = await _photo(db_session, w, driver_id=w.a, request_id=pending.id)
    await confirm(db_session, w, pending, w.a, seal_checks=_seal(w, photo))

    with pytest.raises(SubstitutionInvalidError):
        await confirm(db_session, w, pending, w.b, version=2, seal_checks=_seal(w, photo))


async def test_pending_identity_saves_both_captures_but_blocks_completion(db_session: AsyncSession):
    w, pending = await armed(db_session, identity=IdvsStatus.PENDING)

    read = await both_confirmed(db_session, w, pending)

    assert read.state is SubstitutionState.PENDING and len(read.confirmations) == 2
    assert read.completion_blocked_by is SubstitutionCompletionBlocker.IDENTITY_NOT_VERIFIED
    assert read.identity.status is IdvsStatus.PENDING
    assert await chain(db_session, w.trip_id) == []
    assert (await get_current_custody(db_session, trip=await get_row(db_session, Trip, w.trip_id))).driver_id == w.a


BLOCKERS = [
    ("inactive", IncomingDriverInactiveError, SubstitutionCompletionBlocker.INCOMING_DRIVER_INACTIVE),
    ("licence", LicenceInvalidError, SubstitutionCompletionBlocker.LICENCE_INVALID),
    ("busy", IncomingDriverUnavailableError, SubstitutionCompletionBlocker.DRIVER_UNAVAILABLE),
    ("identity", IdentityNotVerifiedError, SubstitutionCompletionBlocker.IDENTITY_NOT_VERIFIED),
]


async def _apply_blocker(db: AsyncSession, w: SubWorld, name: str) -> None:
    driver = await get_row(db, Driver, w.b)
    if name == "inactive":
        driver.is_active = False
    elif name == "licence":
        driver.license_expiry = None
    elif name == "busy":
        await add_trip(db, w, driver_id=w.b, status=TripStatus.ACTIVE, departure=NOW, arrival=None)
    else:
        driver.idvs_status = IdvsStatus.PENDING
    await db.flush()


@pytest.mark.parametrize(("name", "error", "blocker"), BLOCKERS)
async def test_saved_captures_survive_each_blocker_and_a_dispatcher_recheck_names_it(
    db_session: AsyncSession, name: str, error: type[Exception], blocker: SubstitutionCompletionBlocker,
):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    await _apply_blocker(db_session, w, name)

    blocked = await confirm(db_session, w, first, w.b)

    assert blocked.state is SubstitutionState.PENDING and blocked.completion_blocked_by is blocker
    assert len(blocked.confirmations) == 2 and await chain(db_session, w.trip_id) == []
    with pytest.raises(error):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w, admin=True),
            payload=completion(blocked.version),
        )
    assert await count(db_session, DriverSubstitutionConfirmation) == 2


async def test_blockers_are_reported_in_the_contracts_fixed_order(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    for name, _, _ in BLOCKERS:
        await _apply_blocker(db_session, w, name)

    blocked = await confirm(db_session, w, first, w.b)

    assert blocked.completion_blocked_by is SubstitutionCompletionBlocker.INCOMING_DRIVER_INACTIVE
    expected = [b for _, _, b in BLOCKERS]
    seen = []
    driver = await get_row(db_session, Driver, w.b)
    for name, _, _ in BLOCKERS:
        seen.append((await _read_blocker(db_session, w, pending.id)))
        if name == "inactive":
            driver.is_active = True
        elif name == "licence":
            driver.license_expiry = VALID_LICENCE
        elif name == "busy":
            await db_session.execute(
                update(cast(Table, Trip.__table__)).where(Trip.driver_id == w.b).values(status=TripStatus.CANCELLED.value))
        await db_session.flush()
    assert seen == expected


async def _read_blocker(db: AsyncSession, w: SubWorld, request_id: uuid.UUID) -> SubstitutionCompletionBlocker | None:
    from app.orchestration.substitutions.request_read import Viewer, build_request_read

    request = await get_row(db, DriverSubstitutionRequest, request_id)
    return (await build_request_read(db, request, viewer=Viewer(is_dispatcher=True), now=NOW)).completion_blocked_by


async def test_a_missing_capture_override_never_bypasses_the_other_checks(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    (await get_row(db_session, Driver, w.b)).license_expiry = None
    await db_session.flush()

    with pytest.raises(LicenceInvalidError):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
            payload=completion(first.version, missing="B has no signal"),
        )

    assert await chain(db_session, w.trip_id) == []


async def test_licence_eligibility_uses_actual_sast_completion_date(db_session: AsyncSession, clock: Clock):
    """Arranged while valid; the verdict is taken against the actual completion instant in SAST."""
    w, pending = await armed(db_session)
    (await get_row(db_session, Driver, w.b)).license_expiry = LICENCE_DAY
    await db_session.flush()
    first = await confirm(db_session, w, pending, w.a)

    clock.now = SAST_PAST_MIDNIGHT  # 00:30 SAST on the 26th: the licence ran out at midnight
    blocked = await confirm(db_session, w, first, w.b)
    assert blocked.state is SubstitutionState.PENDING
    assert blocked.completion_blocked_by is SubstitutionCompletionBlocker.LICENCE_INVALID
    assert len(blocked.confirmations) == 2 and await chain(db_session, w.trip_id) == []

    (await get_row(db_session, Driver, w.b)).license_expiry = None
    await db_session.flush()
    with pytest.raises(LicenceInvalidError):  # no expiry on file is never valid
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=completion(blocked.version),
        )

    # Fixing the record does not itself transfer custody; a fresh intentional /complete does,
    # on the saved captures, without any re-upload.
    (await get_row(db_session, Driver, w.b)).license_expiry = date(2026, 12, 31)
    await db_session.flush()
    done = await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=completion(blocked.version),
    )
    assert done.state is SubstitutionState.COMPLETED and done.completion_mode is SubstitutionCompletionMode.NORMAL
    assert done.completion is not None
    assert done.completion.trigger is SubstitutionCompletionTrigger.DISPATCHER_ACTION
    assert done.completion.completed_by_user_id == w.user_id and done.completion.completed_by_driver_id is None
    assert await count(db_session, DriverSubstitutionConfirmation) == 2


async def test_licence_expiring_today_is_valid_until_sast_midnight(db_session: AsyncSession, clock: Clock):
    w, pending = await armed(db_session)
    (await get_row(db_session, Driver, w.b)).license_expiry = LICENCE_DAY
    await db_session.flush()
    first = await confirm(db_session, w, pending, w.a)

    clock.now = SAST_LATE_EVENING  # 23:30 SAST on the expiry date itself
    done = await confirm(db_session, w, first, w.b)

    assert done.state is SubstitutionState.COMPLETED and done.effective_at == SAST_LATE_EVENING
    [row] = await chain(db_session, w.trip_id)
    assert row.incoming_licence_expiry == LICENCE_DAY


async def test_exact_retry_of_a_blocked_confirmation_is_not_a_new_eligibility_check(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    (await get_row(db_session, Driver, w.b)).is_active = False
    await db_session.flush()
    body = capture(w, first.version)
    actor = await driver_actor(db_session, w.b)
    blocked = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=actor, payload=body)
    (await get_row(db_session, Driver, w.b)).is_active = True  # the blocker is resolved...
    await db_session.flush()

    replay = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=actor, payload=body)

    assert replay == blocked and replay.state is SubstitutionState.PENDING  # ...but a retry re-decides nothing
    assert await chain(db_session, w.trip_id) == []


async def test_failed_identity_cannot_be_admin_attested(db_session: AsyncSession):
    w, pending = await armed(db_session, identity=IdvsStatus.FAILED)
    blocked = await both_confirmed(db_session, w, pending)

    with pytest.raises(IdentityNotVerifiedError):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w, admin=True),
            payload=completion(blocked.version, identity="Verified in person at the depot"),
        )

    assert await chain(db_session, w.trip_id) == []
    assert (await get_row(db_session, Driver, w.b)).idvs_status == IdvsStatus.FAILED.value
    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).state == "pending"


async def test_dispatcher_missing_capture_does_not_override_pending_identity(db_session: AsyncSession):
    w, pending = await armed(db_session, identity=IdvsStatus.PENDING)
    first = await confirm(db_session, w, pending, w.a)
    ordinary, admin = dispatcher(w), dispatcher(w, admin=True)

    with pytest.raises(IdentityNotVerifiedError):  # a missing-capture reason alone is not an identity exception
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=ordinary,
            payload=completion(first.version, missing="B has no signal"),
        )
    with pytest.raises(IdentityAttestationForbiddenError):  # and an ordinary dispatcher cannot attest identity
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=ordinary,
            payload=completion(first.version, missing="B has no signal", identity="Checked by phone"),
        )
    assert await chain(db_session, w.trip_id) == []

    done = await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=admin,
        payload=completion(first.version, missing="B has no signal", identity="Checked by phone",
                           declared=NOW - timedelta(minutes=20)),
    )

    assert done.state is SubstitutionState.COMPLETED
    assert done.completion_mode is SubstitutionCompletionMode.DISPATCHER_ATTESTED
    assert done.identity.status is IdvsStatus.PENDING  # never relabelled VERIFIED
    [row] = await chain(db_session, w.trip_id)
    assert (row.incoming_identity_status, row.identity_attested_by_user_id) == ("pending", admin.id)
    assert (row.identity_attestation_reason, row.identity_attested_at) == ("Checked by phone", NOW)
    assert (row.missing_confirmation_reason, row.declared_exchange_at) == ("B has no signal", NOW - timedelta(minutes=20))
    assert row.substitution_at == NOW and row.completed_by_user_id == admin.id
    assert (await get_row(db_session, Driver, w.b)).idvs_status == IdvsStatus.PENDING.value


async def test_an_ordinary_dispatcher_may_attest_missing_captures_for_a_verified_driver(db_session: AsyncSession):
    w, pending = await armed(db_session)

    done = await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
        payload=completion(pending.version, missing="Neither driver has signal"),
    )

    assert done.completion_mode is SubstitutionCompletionMode.DISPATCHER_ATTESTED
    assert done.missing_confirmations == [SubstitutionRole.OUTGOING, SubstitutionRole.INCOMING]
    [row] = await chain(db_session, w.trip_id)
    assert (row.missing_confirmation_reason, row.identity_attested_by_user_id) == ("Neither driver has signal", None)


async def test_complete_needs_a_reason_for_a_missing_capture_and_rejects_inapplicable_ones(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    admin = dispatcher(w, admin=True)

    with pytest.raises(SubstitutionInvalidError):  # B's capture is missing and no reason given
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=admin, payload=completion(first.version))
    with pytest.raises(SubstitutionInvalidError):  # an identity exception for a VERIFIED driver
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=admin,
            payload=completion(first.version, missing="No signal", identity="Not needed"))

    assert await chain(db_session, w.trip_id) == []


async def test_complete_with_a_stale_version_or_after_completion_is_refused_but_a_replay_is_not(db_session: AsyncSession):
    w, pending = await armed(db_session)
    body = completion(pending.version, missing="No signal at the depot")

    first = await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=body)
    replay = await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w), payload=body)

    assert replay == first and len(await chain(db_session, w.trip_id)) == 1
    with pytest.raises(SubstitutionNotPendingError):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
            payload=completion(first.version, missing="Again"))


async def test_complete_with_a_stale_version_is_refused(db_session: AsyncSession):
    w, pending = await armed(db_session)

    with pytest.raises(SubstitutionVersionChangedError):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
            payload=completion(9, missing="No signal"))


async def test_another_organisation_cannot_complete(db_session: AsyncSession):
    w, pending = await armed(db_session)

    with pytest.raises(ResourceNotFoundError):
        await complete_attested_substitution(
            db_session, trip_id=w.trip_id, request_id=pending.id,
            actor=dispatcher(w, organization_id=w.other_org_id), payload=completion(1, missing="x"))


async def test_the_account_going_inactive_after_arrangement_blocks_completion_but_keeps_captures(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.b)
    (await get_row(db_session, Driver, w.b)).is_active = False
    await db_session.flush()

    blocked = await confirm(db_session, w, first, w.a)

    assert blocked.state is SubstitutionState.PENDING
    assert blocked.completion_blocked_by is SubstitutionCompletionBlocker.INCOMING_DRIVER_INACTIVE
    assert {c.driver_id for c in blocked.confirmations} == {w.a, w.b}
    assert (await get_current_custody(db_session, trip=await get_row(db_session, Trip, w.trip_id))).driver_id == w.a


async def test_returning_driver_has_a_new_custody_sequence(db_session: AsyncSession):
    """A -> B -> C -> A through the real service, all stamped with the same instant."""
    w = await world_with_licences(db_session)
    await set_identity(db_session, w.a, IdvsStatus.VERIFIED)
    await set_identity(db_session, w.b, IdvsStatus.VERIFIED)
    await set_identity(db_session, w.c, IdvsStatus.VERIFIED)
    before = await trip_fingerprint(db_session, w)

    for outgoing, incoming in ((w.a, w.b), (w.b, w.c), (w.c, w.a)):
        pending = await arrange_substitution(
            db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=incoming))
        assert pending.outgoing.id == outgoing
        first = await confirm(db_session, w, pending, outgoing)
        done = await confirm(db_session, w, first, incoming)
        assert done.state is SubstitutionState.COMPLETED

    links = await chain(db_session, w.trip_id)
    custody = await get_current_custody(db_session, trip=await get_row(db_session, Trip, w.trip_id))
    assert [link.sequence_number for link in links] == [1, 2, 3]
    assert [link.previous_substitution_id for link in links] == [None, links[0].id, links[1].id]
    assert custody.driver_id == w.a
    assert custody.sequence == 3
    assert custody.substitution_id == links[2].id
    assert (await get_row(db_session, Trip, w.trip_id)).driver_id == w.a
    assert await trip_fingerprint(db_session, w) == before


async def test_completion_is_not_blocked_by_a_trip_that_starts_after_this_one_ends(db_session: AsyncSession):
    """The takeover occupies B only from now to this trip's planned end (NOW + 8h)."""
    w, pending = await armed(db_session)
    await add_trip(db_session, w, driver_id=w.b, status=TripStatus.CREATED, departure=NOW + 9 * HOUR, arrival=NOW + 11 * HOUR)
    await add_trip(db_session, w, driver_id=w.c, status=TripStatus.CREATED, departure=NOW + 5 * HOUR, arrival=NOW + 6 * HOUR)

    done = await both_confirmed(db_session, w, pending)

    assert done.state is SubstitutionState.COMPLETED


async def test_completion_is_blocked_by_a_trip_that_overlaps_the_remaining_leg(db_session: AsyncSession):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)
    await add_trip(db_session, w, driver_id=w.b, status=TripStatus.CREATED, departure=NOW + 7 * HOUR, arrival=NOW + 11 * HOUR)

    blocked = await confirm(db_session, w, first, w.b)

    assert blocked.completion_blocked_by is SubstitutionCompletionBlocker.DRIVER_UNAVAILABLE


# ── termination (CP3) ────────────────────────────────────────────────────────


async def _reserved(db: AsyncSession, w: SubWorld) -> bool:
    busy = await busy_crew_in_window(
        db, organization_id=w.org_id, window=TimeWindow(NOW + 3 * HOUR, NOW + 4 * HOUR), now=NOW,
        crew=CrewFilter(driver_id=w.b),
    )
    return bool(busy)


async def test_terminal_trip_cancels_pending_request_atomically(db_session: AsyncSession):
    """Pending state, the reservation and both notices change together, or not at all."""
    from app.orchestration.trips.administration import cancel_trip

    w, pending = await armed(db_session)
    assert await _reserved(db_session, w)

    with pytest.raises(RuntimeError):  # a failure after the cancellation takes all of it back
        async with db_session.begin_nested():
            await cancel_trip(
                db_session, trip_id=w.trip_id, operator_organization_id=w.org_id, user_id=w.user_id, note="Cargo pulled",
            )
            raise RuntimeError("fail after cancel_trip returned")
    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).state == "pending"
    assert await _reserved(db_session, w)
    assert sorted((await notice_kinds(db_session, pending.id))[w.b]) == ["arranged"]

    await cancel_trip(db_session, trip_id=w.trip_id, operator_organization_id=w.org_id, user_id=w.user_id, note="Cargo pulled")

    request = await get_row(db_session, DriverSubstitutionRequest, pending.id)
    await db_session.refresh(request)
    assert (request.state, request.version, request.terminal_reason) == ("cancelled", 2, "Trip cancelled")
    assert not await _reserved(db_session, w)
    kinds = await notice_kinds(db_session, pending.id)
    assert sorted(kinds[w.a]) == ["arranged", "cancelled"] and sorted(kinds[w.b]) == ["arranged", "cancelled"]
    assert (await get_row(db_session, Trip, w.trip_id)).status == TripStatus.CANCELLED


async def test_normal_closure_cancels_the_pending_request_too(db_session: AsyncSession):
    """The last phase resolving closes the trip; the arrangement cannot outlive it."""
    from app.db.models.enums import PhaseStatus
    from app.orchestration.phases.completion import _finish_phase

    w, pending = await armed(db_session)
    await db_session.execute(
        update(cast(Table, PhaseEvent.__table__)).where(PhaseEvent.trip_id == w.trip_id).values(status=PhaseStatus.COMPLETED.value)
    )
    trip = await get_row(db_session, Trip, w.trip_id)
    event = await get_row(db_session, PhaseEvent, w.confirmation_id)
    await db_session.refresh(event)

    await _finish_phase(db_session, trip=trip, event=event, idempotency_key=str(uuid.uuid4()))

    assert TripStatus(trip.status) is TripStatus.CLOSED
    request = await get_row(db_session, DriverSubstitutionRequest, pending.id)
    await db_session.refresh(request)
    assert (request.state, request.terminal_reason) == ("cancelled", "Trip closed")
    assert not await _reserved(db_session, w)
    assert sorted((await notice_kinds(db_session, pending.id))[w.b]) == ["arranged", "cancelled"]


async def test_a_trip_ending_after_the_handover_completed_keeps_the_transfer(db_session: AsyncSession):
    """If completion won the race there is nothing pending to cancel and custody stays with B."""
    from app.orchestration.trips.administration import cancel_trip

    w, pending = await armed(db_session)
    await both_confirmed(db_session, w, pending)

    await cancel_trip(db_session, trip_id=w.trip_id, operator_organization_id=w.org_id, user_id=w.user_id, note="Cargo pulled")

    trip = await get_row(db_session, Trip, w.trip_id)
    assert (await get_current_custody(db_session, trip=trip)).driver_id == w.b
    assert len(await chain(db_session, w.trip_id)) == 1
    assert (await get_row(db_session, DriverSubstitutionRequest, pending.id)).state == "completed"
    kinds = await notice_kinds(db_session, pending.id)
    assert sorted(kinds[w.a]) == ["arranged", "completed"] and sorted(kinds[w.b]) == ["arranged", "completed"]


async def test_terminal_cancellation_with_nothing_pending_is_a_no_op(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    trip = await get_row(db_session, Trip, w.trip_id)

    await cancel_pending_for_terminal_trip(db_session, trip=trip, reason="Trip closed")

    assert await count(db_session, DriverSubstitutionNotice) == 0


# ── correction (CP3) ─────────────────────────────────────────────────────────


def correction(*, key: uuid.UUID | None = None, note: str = "Exchange was at the second gate") -> CorrectSubstitutionRequest:
    return CorrectSubstitutionRequest(client_request_id=key or uuid.uuid4(), reason="Wrong gate recorded", correction_note=note)


async def completed_transfer(db: AsyncSession) -> tuple[SubWorld, DriverSubstitution]:
    w, pending = await armed(db)
    await both_confirmed(db, w, pending)
    [row] = await chain(db, w.trip_id)
    return w, row


async def test_a_correction_is_an_immutable_clarification_that_changes_no_custody(db_session: AsyncSession):
    w, row = await completed_transfer(db_session)
    before_row = (row.original_driver_id, row.substituting_driver_id, row.substitution_at, row.sequence_number)
    trip = await get_row(db_session, Trip, w.trip_id)
    before = await get_current_custody(db_session, trip=trip)

    read = await correct_completed_substitution(
        db_session, trip_id=w.trip_id, substitution_id=row.id, actor=dispatcher(w), payload=correction(),
    )

    from app.db.models.driver_substitutions import DriverSubstitutionCorrection
    from app.db.models.enums import AnchorStatus

    assert (read.substitution_id, read.recorded_by_user_id) == (row.id, w.user_id)
    assert (read.reason, read.correction_note) == ("Wrong gate recorded", "Exchange was at the second gate")
    assert (read.anchor_status, read.receipt_id, read.recorded_at) == (AnchorStatus.PENDING, None, NOW)
    stored = await get_row(db_session, DriverSubstitutionCorrection, read.id)
    assert (stored.payload_version, len(stored.event_hash), stored.anchor_status) == (1, 64, "pending")
    assert "second gate" not in str(stored.payload_json) and "Wrong gate" not in str(stored.payload_json)
    await db_session.refresh(row)
    assert (row.original_driver_id, row.substituting_driver_id, row.substitution_at, row.sequence_number) == before_row
    assert await get_current_custody(db_session, trip=trip) == before


async def test_correction_note_retries_return_the_same_clarification(db_session: AsyncSession):
    from app.db.models.driver_substitutions import DriverSubstitutionCorrection

    w, row = await completed_transfer(db_session)
    key = uuid.uuid4()
    first = await correct_completed_substitution(
        db_session, trip_id=w.trip_id, substitution_id=row.id, actor=dispatcher(w), payload=correction(key=key))

    replay = await correct_completed_substitution(
        db_session, trip_id=w.trip_id, substitution_id=row.id, actor=dispatcher(w), payload=correction(key=key))
    with pytest.raises(IdempotencyKeyReusedError):
        await correct_completed_substitution(
            db_session, trip_id=w.trip_id, substitution_id=row.id, actor=dispatcher(w), payload=correction(key=key, note="Edited"))
    second = await correct_completed_substitution(
        db_session, trip_id=w.trip_id, substitution_id=row.id, actor=dispatcher(w), payload=correction(note="A further note"))

    assert replay == first and second.id != first.id
    assert await count(db_session, DriverSubstitutionCorrection) == 2


async def test_another_organisations_substitution_cannot_be_corrected(db_session: AsyncSession):
    from app.db.models.driver_substitutions import DriverSubstitutionCorrection

    w, row = await completed_transfer(db_session)

    with pytest.raises(ResourceNotFoundError):
        await correct_completed_substitution(
            db_session, trip_id=w.trip_id, substitution_id=row.id,
            actor=dispatcher(w, organization_id=w.other_org_id), payload=correction())
    with pytest.raises(ResourceNotFoundError):  # a substitution id that is not on the named trip
        await correct_completed_substitution(
            db_session, trip_id=w.trip_id, substitution_id=uuid.uuid4(), actor=dispatcher(w), payload=correction())

    assert await count(db_session, DriverSubstitutionCorrection) == 0

async def test_completed_transfer_preserves_exception_hold(db_session: AsyncSession):
    w, pending = await armed(db_session)
    trip = await get_row(db_session, Trip, w.trip_id)
    trip.status = TripStatus.EXCEPTION_HOLD
    await db_session.flush()
    before = await trip_fingerprint(db_session, w)
    phase_before = (trip.current_phase, trip.current_stop)

    result = await both_confirmed(db_session, w, pending)

    assert result.state is SubstitutionState.COMPLETED
    await db_session.refresh(trip)
    assert trip.status == TripStatus.EXCEPTION_HOLD
    assert (trip.current_phase, trip.current_stop) == phase_before
    assert await trip_fingerprint(db_session, w) == before
