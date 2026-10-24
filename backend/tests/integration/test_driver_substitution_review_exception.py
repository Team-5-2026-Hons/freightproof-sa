"""A completed driver transfer that carries a problem raises one `driver_substitution` exception.

Clean transfers raise nothing. The tracker is staged through the same seam as the CP4 tests so
"within limit", "uncomparable" and "separated" are exact.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import ExceptionReviewStatus, ExceptionSeverity, ExceptionType, IdvsStatus, TripStatus
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.integrations.pulsit import PulsitFix
from app.orchestration.substitutions import transfer_review
from app.orchestration.substitutions.service import complete_attested_substitution
from app.schemas.driver_substitutions import SubstitutionRequestRead, SubstitutionState
from tests.integration._driver_substitution_world import SubWorld
from tests.integration.test_driver_substitution_seal_findings import FAR_AWAY, _staged_fixture, confirm, tracker  # noqa: F401 - registered under the name `staged`
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    armed, chain, clock, completion, dispatcher, get_row,
)


async def review_exceptions(db: AsyncSession, trip_id) -> list[TripException]:
    return list((await db.execute(select(TripException).where(
        TripException.trip_id == trip_id, TripException.exception_type == ExceptionType.DRIVER_SUBSTITUTION.value,
    ))).scalars())


async def names(db: AsyncSession, w: SubWorld) -> tuple[str, str]:
    return (await get_row(db, Driver, w.a)).full_name, (await get_row(db, Driver, w.b)).full_name


async def both_confirm(db: AsyncSession, w: SubWorld, pending: SubstitutionRequestRead) -> SubstitutionRequestRead:
    first = await confirm(db, w, pending, w.a)
    return await confirm(db, w, first, w.b)


async def attest_identity(db: AsyncSession, w: SubWorld, read: SubstitutionRequestRead) -> SubstitutionRequestRead:
    return await complete_attested_substitution(
        db, trip_id=w.trip_id, request_id=read.id, actor=dispatcher(w, admin=True),
        payload=completion(read.version, identity="IDVS unavailable"),
    )


async def test_a_clean_transfer_raises_no_review_exception(db_session: AsyncSession, staged: dict[str, PulsitFix]):
    w, pending = await armed(db_session)

    done = await both_confirm(db_session, w, pending)

    assert done.state is SubstitutionState.COMPLETED
    assert await review_exceptions(db_session, w.trip_id) == []


async def test_an_attested_pending_identity_raises_one_warning_naming_both_drivers(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    w, pending = await armed(db_session, identity=IdvsStatus.PENDING)
    blocked = await both_confirm(db_session, w, pending)

    done = await attest_identity(db_session, w, blocked)

    [raised] = await review_exceptions(db_session, w.trip_id)
    outgoing, incoming = await names(db_session, w)
    assert done.state is SubstitutionState.COMPLETED
    assert raised.description == (
        f"Driver transfer from {outgoing} to {incoming} completed with: incoming identity not verified (attested by dispatcher)."
    )
    assert (raised.severity, raised.source, raised.review_status) == (
        ExceptionSeverity.WARNING.value, "system", ExceptionReviewStatus.NEEDS_REVIEW.value,
    )
    assert raised.phase_event_id is None


async def test_a_missing_required_confirmation_raises_one(db_session: AsyncSession, staged: dict[str, PulsitFix]):
    w, pending = await armed(db_session)
    first = await confirm(db_session, w, pending, w.a)

    await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=first.id, actor=dispatcher(w),
        payload=completion(first.version, missing="Incoming driver's phone is dead"),
    )

    [raised] = await review_exceptions(db_session, w.trip_id)
    assert "required driver confirmation not recorded" in raised.description


async def test_an_uncomparable_incoming_location_raises_one(db_session: AsyncSession, staged: dict[str, PulsitFix]):
    staged["fix"] = tracker(None)
    w, pending = await armed(db_session)

    await both_confirm(db_session, w, pending)

    [raised] = await review_exceptions(db_session, w.trip_id)
    assert raised.description.endswith("completed with: handover location not verified.")


async def test_several_problems_make_one_exception_listing_every_reason(
    db_session: AsyncSession, staged: dict[str, PulsitFix],
):
    staged["fix"] = tracker(None)
    w, pending = await armed(db_session, identity=IdvsStatus.PENDING)
    blocked = await both_confirm(db_session, w, pending)

    await attest_identity(db_session, w, blocked)

    [raised] = await review_exceptions(db_session, w.trip_id)
    assert "incoming identity not verified (attested by dispatcher); handover location not verified" in raised.description


async def test_a_separated_capture_is_left_to_its_own_finding(db_session: AsyncSession, staged: dict[str, PulsitFix]):
    staged["fix"] = tracker(FAR_AWAY)
    w, pending = await armed(db_session)

    await both_confirm(db_session, w, pending)

    assert await review_exceptions(db_session, w.trip_id) == []
    separation = (await db_session.execute(select(TripException).where(
        TripException.trip_id == w.trip_id, TripException.exception_type == ExceptionType.DRIVER_VEHICLE_SEPARATION.value,
    ))).scalars().all()
    assert separation


async def test_the_trip_is_not_held_by_the_review_exception(db_session: AsyncSession, staged: dict[str, PulsitFix]):
    staged["fix"] = tracker(None)
    w, pending = await armed(db_session)

    await both_confirm(db_session, w, pending)

    assert (await get_row(db_session, Trip, w.trip_id)).status == TripStatus.ACTIVE
    assert await review_exceptions(db_session, w.trip_id)


async def test_the_transfer_still_completes_when_the_exception_cannot_be_written(
    db_session: AsyncSession, staged: dict[str, PulsitFix], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
):
    async def broken(*_args: object, **_kwargs: object) -> None:
        raise OperationalError("insert", {}, Exception("db hiccup"))

    monkeypatch.setattr(transfer_review, "register_exception", broken)
    staged["fix"] = tracker(None)
    w, pending = await armed(db_session)

    done = await both_confirm(db_session, w, pending)

    assert done.state is SubstitutionState.COMPLETED
    assert len(await chain(db_session, w.trip_id)) == 1
    assert await review_exceptions(db_session, w.trip_id) == []
    assert "review exception not recorded" in caplog.text


async def test_the_transfer_still_completes_when_the_review_fails_outside_the_database(
    db_session: AsyncSession, staged: dict[str, PulsitFix], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
):
    def broken(*_args: object, **_kwargs: object) -> str:
        raise ValueError("unexpected description input")

    monkeypatch.setattr(transfer_review, "transfer_review_description", broken)
    staged["fix"] = tracker(None)
    w, pending = await armed(db_session)

    done = await both_confirm(db_session, w, pending)

    assert done.state is SubstitutionState.COMPLETED
    assert len(await chain(db_session, w.trip_id)) == 1
    assert await review_exceptions(db_session, w.trip_id) == []
    assert "review exception not recorded" in caplog.text
