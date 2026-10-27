"""FP-83 C3 CP4: each handover capture's location assessment, and the two-capture seal comparison.

Run on the rolled-back `db_session` like the C3 service tests. The tracker is replaced by a
staged fix on `capture_assessment.read_horse_fix` (the one seam the service reads it through), so
"fresh and close", "separated" and "tracker outage" are exact rather than whatever Redis holds.
"""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import DriverSubstitutionConfirmation, DriverSubstitutionUpload
from app.db.models.enums import ArtifactType, ExceptionSeverity, ExceptionType, IdvsStatus, TripStatus
from app.db.models.evidence import EvidenceArtifact
from app.db.models.transit import TripException
from app.db.models.trips import DriverSubstitution, Trip
from app.integrations.pulsit import PulsitFix, PulsitFixSource, PulsitFixStatus
from app.orchestration.evidence import location_assessment
from app.orchestration.substitutions import capture_assessment
from app.orchestration.substitutions.service import confirm_substitution
from app.schemas.driver_substitutions import (
    ConfirmSubstitutionRequest, SealCheck, SubstitutionRequestRead, SubstitutionSealCondition, SubstitutionState,
)
from tests.integration._driver_substitution_world import SubWorld
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, armed, capture, clock, driver_actor,
)

EXCHANGE = (-32.35, 22.58)
FAR_AWAY = (-32.34, 22.58)
FRESH = NOW - timedelta(seconds=5)


def tracker(position: tuple[float, float] | None, *, fixed_at: datetime = FRESH) -> PulsitFix:
    if position is None:
        return PulsitFix(device_id="PUL-X", status=PulsitFixStatus.NO_FIX, source=PulsitFixSource.MOCK,
                         lat=None, lng=None, fixed_at=None)
    return PulsitFix(device_id="PUL-X", status=PulsitFixStatus.OK, source=PulsitFixSource.MOCK,
                     lat=Decimal(str(position[0])), lng=Decimal(str(position[1])), fixed_at=fixed_at)


@pytest.fixture(name="staged")
def _staged_fixture(monkeypatch: pytest.MonkeyPatch) -> dict[str, PulsitFix]:
    """The tracker fix the next confirmation will see; defaults to fresh and at the exchange."""
    box = {"fix": tracker(EXCHANGE)}

    async def _read(db: AsyncSession, *, trip_id: uuid.UUID) -> PulsitFix:
        return box["fix"]

    monkeypatch.setattr(capture_assessment, "read_horse_fix", _read)
    return box


async def photo(db: AsyncSession, w: SubWorld, driver_id: uuid.UUID, request_id: uuid.UUID) -> uuid.UUID:
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=w.trip_id, artifact_type=ArtifactType.PHOTO.value, s3_key=f"k/{uuid.uuid4()}",
        s3_bucket="b", file_hash=uuid.uuid4().hex + uuid.uuid4().hex, mime_type="image/jpeg",
        captured_by_driver_id=driver_id, captured_at=FRESH,
    )
    db.add(artifact)
    await db.flush()
    db.add(DriverSubstitutionUpload(
        artifact_id=artifact.id, trip_id=w.trip_id, driver_id=driver_id, purpose="handover", request_id=request_id,
        role="outgoing" if driver_id == w.a else "incoming",
    ))
    await db.flush()
    return artifact.id


async def seal(db: AsyncSession, w: SubWorld, driver_id: uuid.UUID, request_id: uuid.UUID, *,
               number: str | None = "AB-1234",
               condition: SubstitutionSealCondition = SubstitutionSealCondition.INTACT) -> list[SealCheck]:
    return [SealCheck(
        vehicle_id=w.horse_id, condition=condition, seal_number=number,
        photo_artifact_ids=[await photo(db, w, driver_id, request_id)],
    )]


def fresh_capture(w: SubWorld, version: int, **kwargs) -> ConfirmSubstitutionRequest:
    return capture(w, version, **kwargs).model_copy(update={"captured_at": FRESH})


async def confirm(db: AsyncSession, w: SubWorld, read: SubstitutionRequestRead, driver_id: uuid.UUID,
                  body: ConfirmSubstitutionRequest | None = None) -> SubstitutionRequestRead:
    return await confirm_substitution(
        db, trip_id=w.trip_id, request_id=read.id, actor=await driver_actor(db, driver_id),
        payload=body or fresh_capture(w, read.version),
    )


async def saved(db: AsyncSession, driver_id: uuid.UUID) -> DriverSubstitutionConfirmation:
    return (await db.execute(
        select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.driver_id == driver_id)
    )).scalar_one()


async def findings(db: AsyncSession, trip_id: uuid.UUID) -> list[TripException]:
    return list((await db.execute(
        select(TripException).where(TripException.trip_id == trip_id).order_by(TripException.exception_type)
    )).scalars())



async def test_a_capture_beside_its_truck_is_within_limit_and_raises_nothing(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session)

    await confirm(db_session, w, pending, w.a)

    assessment = (await saved(db_session, w.a)).action_location_assessment
    assert assessment is not None
    assert assessment["proximity"] == "within_limit" and assessment["reasons"] == []
    assert assessment["precinct_id"] is None and assessment["expected_trip_stop_id"] is None
    assert await findings(db_session, w.trip_id) == []


async def test_a_capture_far_from_its_truck_raises_one_separation_scoped_to_that_capture(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session)
    staged["fix"] = tracker(FAR_AWAY)

    read = await confirm(db_session, w, pending, w.a)

    capture_row = await saved(db_session, w.a)
    assert capture_row.action_location_assessment is not None
    assert capture_row.action_location_assessment["proximity"] == "separated"
    [finding] = await findings(db_session, w.trip_id)
    assert finding.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION
    assert finding.substitution_confirmation_id == capture_row.id
    assert (finding.phase_event_id, finding.checkpoint_id) == (None, None)
    assert read.state is SubstitutionState.PENDING


@pytest.mark.parametrize("case", ["tracker_outage", "no_phone_fix"])
async def test_an_unassessable_capture_is_kept_and_recorded_as_unverified(
    db_session: AsyncSession, staged: dict[str, PulsitFix], case: str,
):
    w, pending = await armed(db_session)
    body = fresh_capture(w, 1)
    if case == "tracker_outage":
        staged["fix"] = tracker(None)
    else:
        body = body.model_copy(update={"latitude": None, "longitude": None, "accuracy_metres": None})

    await confirm(db_session, w, pending, w.a, body)

    assessment = (await saved(db_session, w.a)).action_location_assessment
    assert assessment is not None
    expected = "missing_tracker" if case == "tracker_outage" else "missing_phone"
    assert assessment["proximity"] == "unverified" and expected in assessment["reasons"]
    assert await findings(db_session, w.trip_id) == []


async def test_a_failure_building_the_assessment_keeps_the_capture_as_not_assessed(
    db_session: AsyncSession, staged: dict[str, PulsitFix], monkeypatch: pytest.MonkeyPatch,
):
    w, pending = await armed(db_session)

    def _boom(**_: object) -> None:
        raise RuntimeError("assessment exploded")

    monkeypatch.setattr(location_assessment, "build_capture_assessment", _boom)

    read = await confirm(db_session, w, pending, w.a)

    assert (await saved(db_session, w.a)).action_location_assessment is None
    assert read.state is SubstitutionState.PENDING and read.version == 2


async def test_the_tracker_read_never_raises(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch):
    w, _ = await armed(db_session)

    def _broken_client(**_: object) -> None:
        raise ConnectionError("Pulsit down")

    monkeypatch.setattr(capture_assessment, "get_pulsit_client", _broken_client)

    fix = await capture_assessment.read_horse_fix(db_session, trip_id=w.trip_id)

    assert fix.status is PulsitFixStatus.UNAVAILABLE and not fix.has_position



async def test_matching_seal_readings_complete_with_no_finding(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a, fresh_capture(
        w, 1, seal_checks=await seal(db_session, w, w.a, pending.id)))

    done = await confirm(db_session, w, first, w.b, fresh_capture(
        w, first.version, seal_checks=await seal(db_session, w, w.b, pending.id)))

    assert done.state is SubstitutionState.COMPLETED
    assert await findings(db_session, w.trip_id) == []


async def test_differing_seal_numbers_record_one_mismatch_without_blocking_the_handover(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a, fresh_capture(
        w, 1, seal_checks=await seal(db_session, w, w.a, pending.id, number="AB-1234")))

    done = await confirm(db_session, w, first, w.b, fresh_capture(
        w, first.version, seal_checks=await seal(db_session, w, w.b, pending.id, number="AB-9999")))

    [finding] = await findings(db_session, w.trip_id)
    assert finding.exception_type == ExceptionType.SEAL_MISMATCH
    assert finding.severity == ExceptionSeverity.CRITICAL
    assert (finding.substitution_confirmation_id, finding.vehicle_id) == ((await saved(db_session, w.b)).id, w.horse_id)
    assert "AB-1234" in finding.description and "AB-9999" in finding.description
    assert done.state is SubstitutionState.COMPLETED
    [link] = (await db_session.execute(select(DriverSubstitution))).scalars().all()
    assert link.exception_id is None
    trip = await db_session.get(Trip, w.trip_id)
    assert trip is not None
    await db_session.refresh(trip)
    assert TripStatus(trip.status) is TripStatus.ACTIVE


async def test_a_broken_seal_is_recorded_even_when_completion_is_blocked(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session, identity=IdvsStatus.PENDING)
    first = await confirm(db_session, w, pending, w.a, fresh_capture(
        w, 1, seal_checks=await seal(db_session, w, w.a, pending.id)))

    blocked = await confirm(db_session, w, first, w.b, fresh_capture(w, first.version, seal_checks=await seal(db_session, w, w.b, pending.id, number=None, condition=SubstitutionSealCondition.MISSING)))

    assert blocked.state is SubstitutionState.PENDING and blocked.completion_blocked_by is not None
    kinds = sorted(f.exception_type for f in await findings(db_session, w.trip_id))
    assert kinds == [ExceptionType.SEAL_COMPROMISED]


async def test_an_exact_replay_of_the_second_capture_writes_no_duplicate_finding(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a, fresh_capture(
        w, 1, seal_checks=await seal(db_session, w, w.a, pending.id, number="AB-1234")))
    body = fresh_capture(w, first.version, seal_checks=await seal(db_session, w, w.b, pending.id, number="AB-9999"))
    original = await confirm(db_session, w, first, w.b, body)

    replay = await confirm(db_session, w, first, w.b, body)

    assert replay == original
    assert len(await findings(db_session, w.trip_id)) == 1
