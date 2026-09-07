"""FP-146 — review_exception at the service level.

Complements tests/integration/test_exceptions_dispatcher.py rather than repeating it.
The integration tests own the HTTP contract (status codes, request shape); these own the
things HTTP cannot see — that the reviewer comes from the caller's identity rather than
anything in the payload, and that a review reaches the realtime outbox before the
transaction commits.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.exceptions import ExceptionAlreadyReviewedError, ResourceNotFoundError
from app.core.realtime import EventSeverity, RealtimeKind
from app.db.models.enums import (
    ArtifactType,
    DispatcherReviewOutcome,
    ExceptionContactMethod,
    ExceptionReviewOutcome,
    ExceptionReviewStatus,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
    VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.orchestration.exception_service import (
    initial_review_status,
    raise_exception,
    review_exception,
)

_OUTBOX_KEY = "realtime_outbox"

_NOTE = "Phoned the depot; the seal was cut during a lawful SARS inspection."


async def _seed(db_session, *, tag: str) -> dict:
    """One operator org with a trip and one unresolved exception on it."""
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"disp-{tag}@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RG{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="O", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="D", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([user, driver, horse, origin, dest])
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

    exc = TripException(
        id=uuid.uuid4(), trip_id=trip.id,
        exception_type=ExceptionType.SEAL_MISMATCH,
        source=ExceptionSource.SYSTEM, severity=ExceptionSeverity.CRITICAL,
        description="Seal at destination does not match departure.",
    )
    db_session.add(exc)
    await db_session.flush()

    return {"org": org, "user": user, "trip": trip, "exception": exc}


def _outbox(db_session) -> list:
    return db_session.info.get(_OUTBOX_KEY, [])


async def _review(db_session, seed, **overrides):
    kwargs = {
        "exception_id": seed["exception"].id,
        "user_id": seed["user"].id,
        "organization_id": seed["org"].id,
        "review_note": _NOTE,
        "review_outcome": DispatcherReviewOutcome.EVIDENCE_VERIFIED,
        "contact_method": ExceptionContactMethod.PHONE,
    }
    kwargs.update(overrides)
    return await review_exception(db_session, **kwargs)


# ── initial review status ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        (ExceptionSeverity.CRITICAL, ExceptionReviewStatus.NEEDS_REVIEW),
        (ExceptionSeverity.WARNING, ExceptionReviewStatus.RECORDED),
        (ExceptionSeverity.INFO, ExceptionReviewStatus.RECORDED),
    ],
)
def test_initial_review_status_is_derived_from_severity(severity, expected) -> None:
    assert initial_review_status(severity) == expected


# ── review ───────────────────────────────────────────────────────────────────


async def test_review_sets_complete_evidence_from_the_caller(db_session):
    """The identity is an argument, never a field on the request body. This is the whole
    reason review_exception takes a narrow request instead of TripExceptionUpdate,
    which would have let a caller name someone else as the reviewer."""
    seed = await _seed(db_session, tag="reviewer")

    before = datetime.now(UTC)
    await _review(db_session, seed)

    exc = seed["exception"]
    assert exc.review_status == ExceptionReviewStatus.REVIEWED
    assert exc.review_outcome == ExceptionReviewOutcome.EVIDENCE_VERIFIED
    assert exc.reviewed_by_user_id == seed["user"].id
    # == not is: contact_method is a String(20) column (matching severity/source on
    # this table), so it round-trips as a plain str. ExceptionContactMethod subclasses
    # str, which makes equality work and identity fail.
    assert exc.contact_method == ExceptionContactMethod.PHONE
    assert exc.review_note == _NOTE
    # Set by this process, not by the database — deliberately asserted against the Python
    # clock. The test database's own clock cannot be trusted for this (known-issues §6).
    assert before - timedelta(seconds=5) <= exc.reviewed_at <= datetime.now(UTC)


async def test_review_refuses_another_organisations_exception(db_session):
    """Org scoping is authorisation. A dispatcher holding a valid token for their own
    org must not reach another operator's row by guessing its id."""
    mine = await _seed(db_session, tag="mine")
    theirs = await _seed(db_session, tag="theirs")

    with pytest.raises(ResourceNotFoundError):
        await _review(
            db_session, mine,
            exception_id=theirs["exception"].id,  # their row, my credentials
        )

    assert theirs["exception"].review_status == ExceptionReviewStatus.RECORDED


async def test_review_of_an_unknown_id_raises(db_session):
    seed = await _seed(db_session, tag="unknown")

    with pytest.raises(ResourceNotFoundError):
        await _review(db_session, seed, exception_id=uuid.uuid4())


async def test_the_same_dispatcher_reviewing_twice_is_idempotent(db_session):
    """A double-tap or a retried request from the SAME dispatcher carries the same
    account, so nothing is lost by returning the stored row unchanged. This is the case
    the offline/replay path depends on and it must not raise."""
    seed = await _seed(db_session, tag="twice")

    first = await _review(db_session, seed)
    second = await _review(
        db_session, seed,
        review_note="A different account of the same incident.",
        review_outcome=DispatcherReviewOutcome.REFERRED_FOR_FOLLOW_UP,
        contact_method=ExceptionContactMethod.IN_PERSON,
    )

    assert second.reviewed_at == first.reviewed_at
    assert second.review_note == _NOTE
    assert second.review_outcome == ExceptionReviewOutcome.EVIDENCE_VERIFIED
    assert second.contact_method is ExceptionContactMethod.PHONE


async def test_a_second_dispatcher_reviewing_is_told_they_lost(db_session):
    """The first account stays the record — but the second dispatcher must not be told
    their note was recorded when it was discarded. They may have established something
    the first reviewer did not, and on an evidence platform a silent drop is the failure.
    """
    seed = await _seed(db_session, tag="race")
    await _review(db_session, seed)
    other_dispatcher = User(
        id=uuid.uuid4(), organization_id=seed["org"].id,
        email="second-race@test.co.za", full_name="Second Dispatcher",
    )
    db_session.add(other_dispatcher)
    await db_session.flush()

    with pytest.raises(ExceptionAlreadyReviewedError):
        await _review(
            db_session, seed,
            user_id=other_dispatcher.id,
            review_note="Phoned the driver; he says the inspection was at Beitbridge.",
            review_outcome=DispatcherReviewOutcome.REFERRED_FOR_FOLLOW_UP,
            contact_method=ExceptionContactMethod.IN_PERSON,
        )

    # The first account survives untouched — the raise is about telling the loser, not
    # about protecting the row, which was never at risk.
    exc = seed["exception"]
    assert exc.review_note == _NOTE
    assert exc.reviewed_by_user_id == seed["user"].id


async def test_a_review_with_no_recorded_reviewer_counts_as_a_conflict(db_session):
    """A row reviewed before reviewed_by_user_id was captured cannot be proved to belong
    to this caller, so it is treated as someone else's. Guessing 'probably them' would
    let the NULL case silently discard a note."""
    seed = await _seed(db_session, tag="legacy")
    exc = seed["exception"]
    exc.review_status = ExceptionReviewStatus.REVIEWED
    exc.reviewed_by_user_id = None
    await db_session.flush()

    with pytest.raises(ExceptionAlreadyReviewedError):
        await _review(db_session, seed)


async def test_review_enqueues_an_info_event(db_session):
    """Other dispatchers are looking at the same queue, so the list must refresh — but a
    review is progress, not an alarm, and must not interrupt anyone mid-shift.

    Only visible here: the integration client commits, which drains the outbox.
    """
    seed = await _seed(db_session, tag="emit")

    await _review(db_session, seed)

    assert len(_outbox(db_session)) == 1
    org_id, event = _outbox(db_session)[0]
    assert org_id == seed["org"].id
    assert event.id == seed["trip"].id
    assert event.kind is RealtimeKind.EXCEPTION_REVIEWED
    assert event.severity is EventSeverity.INFO


async def test_a_suppressed_repeat_review_enqueues_nothing(db_session):
    """No new record, no new event — the same rule the scan-discrepancy emit follows."""
    seed = await _seed(db_session, tag="emit-twice")
    await _review(db_session, seed)
    db_session.info.pop(_OUTBOX_KEY, None)

    await _review(db_session, seed)

    assert _outbox(db_session) == []


# ── Task 0B: raise_exception — evidence ownership + client_report_id idempotency ──


async def _seed_trip(db_session, *, tag: str) -> dict:
    """One operator org with an active trip and its assigned driver, and NO exception
    on it yet — unlike _seed above, which pre-seeds one for the review tests."""
    org = Organization(id=uuid.uuid4(), name=f"Op-{tag}", org_type=OrganizationType.OPERATOR)
    client_org = Organization(
        id=uuid.uuid4(), name=f"Cl-{tag}", org_type=OrganizationType.PRINCIPAL,
    )
    db_session.add_all([org, client_org])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"disp-{tag}@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567",
        license_number=f"DRV-{tag}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"RG{tag.upper()[:6]}", pulsit_device_id=f"PUL-{tag}",
    )
    origin = Precinct(
        id=uuid.uuid4(), name="O", principal_organization_id=client_org.id,
        latitude="0", longitude="0",
    )
    dest = Precinct(
        id=uuid.uuid4(), name="D", principal_organization_id=client_org.id,
        latitude="1", longitude="1",
    )
    db_session.add_all([user, driver, horse, origin, dest])
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

    return {"org": org, "trip": trip, "driver": driver}


async def _make_artifact(db_session, trip_id) -> EvidenceArtifact:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/jpeg", captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact


async def test_raise_exception_rejects_an_artifact_from_another_trip(db_session):
    """The FK on supporting_artifact_id only proves the artifact exists somewhere —
    the service, not the schema or the database, is what proves it belongs to THIS
    trip. Must leave no half-written exception and no realtime ping behind."""
    mine = await _seed_trip(db_session, tag="art-mine")
    theirs = await _seed_trip(db_session, tag="art-theirs")
    foreign_artifact = await _make_artifact(db_session, theirs["trip"].id)

    with pytest.raises(ResourceNotFoundError):
        await raise_exception(
            db_session, trip_id=mine["trip"].id, driver_id=mine["driver"].id,
            exception_type=ExceptionType.CARGO_DAMAGE, description="Pallet crushed.",
            supporting_artifact_id=foreign_artifact.id,
        )

    assert _outbox(db_session) == []


async def test_raise_exception_rejects_an_artifact_that_does_not_exist(db_session):
    seed = await _seed_trip(db_session, tag="art-missing")

    with pytest.raises(ResourceNotFoundError):
        await raise_exception(
            db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
            exception_type=ExceptionType.CARGO_DAMAGE, description="Pallet crushed.",
            supporting_artifact_id=uuid.uuid4(),
        )


async def test_raise_exception_accepts_an_artifact_owned_by_this_trip(db_session):
    seed = await _seed_trip(db_session, tag="art-owned")
    artifact = await _make_artifact(db_session, seed["trip"].id)

    result = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="Pallet crushed.",
        supporting_artifact_id=artifact.id,
    )

    assert result.supporting_artifact_id == artifact.id
    # CARGO_DAMAGE is not in _CRITICAL_TYPES, so it is WARNING severity and starts
    # RECORDED, not NEEDS_REVIEW (Task 2, FP-146 follow-on).
    assert result.review_status == ExceptionReviewStatus.RECORDED


async def test_raise_exception_replays_the_same_client_report_id(db_session):
    """A lost response, or the offline queue resending the same queued entry, must
    return the ORIGINAL exception — no second row, no second realtime event."""
    seed = await _seed_trip(db_session, tag="idem-replay")
    report_id = uuid.uuid4()

    first = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="Pallet crushed.",
        supporting_artifact_id=None, client_report_id=report_id,
    )
    db_session.info.pop(_OUTBOX_KEY, None)

    second = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="Pallet crushed.",
        supporting_artifact_id=None, client_report_id=report_id,
    )

    assert second.id == first.id
    assert _outbox(db_session) == []
    rows = (await db_session.execute(
        select(TripException).where(TripException.trip_id == seed["trip"].id)
    )).scalars().all()
    assert len(rows) == 1


async def test_raise_exception_with_a_different_client_report_id_creates_a_new_row(db_session):
    seed = await _seed_trip(db_session, tag="idem-distinct")

    first = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="First report.",
        supporting_artifact_id=None, client_report_id=uuid.uuid4(),
    )
    second = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="Second, unrelated report.",
        supporting_artifact_id=None, client_report_id=uuid.uuid4(),
    )

    assert first.id != second.id


async def test_raise_exception_without_a_client_report_id_is_unaffected(db_session):
    """An older installed client sends none — must behave exactly as before this task,
    with no idempotency machinery engaged at all."""
    seed = await _seed_trip(db_session, tag="idem-none")

    result = await raise_exception(
        db_session, trip_id=seed["trip"].id, driver_id=seed["driver"].id,
        exception_type=ExceptionType.CARGO_DAMAGE, description="No report id.",
        supporting_artifact_id=None,
    )

    assert result.id is not None
