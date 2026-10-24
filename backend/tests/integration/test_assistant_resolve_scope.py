"""The resolver's loaders against a real database (assistant spec B4): only the caller's own
organisation's drivers, vehicles, trips and depots are ever matched, by text or by ref."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import VehicleType
from app.db.models.organisations import Precinct
from app.orchestration.assistant.resolve import resolve_driver, resolve_precinct, resolve_trip, resolve_vehicle
from tests.integration._fleet_seed import (
    days_ago, new_driver, new_vehicle, operator_from_seed, other_operator, seed_trip,
)


async def test_resolve_driver_by_text_ignores_another_orgs_driver(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)
    mine = new_driver(seed["org"].id)
    mine.full_name = "Tim Giltig"
    theirs = new_driver(other.org.id)
    theirs.full_name = "Tim Giltig"
    db_session.add_all([mine, theirs])
    await db_session.flush()

    resolution = await resolve_driver(db_session, organization_id=seed["org"].id, text="tim giltig")

    assert resolution.match is not None
    assert resolution.match.id == mine.id


async def test_resolve_driver_ref_from_another_org_is_not_found(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)

    own = await resolve_driver(db_session, organization_id=seed["org"].id, ref=seed["driver"].id)
    foreign = await resolve_driver(db_session, organization_id=seed["org"].id, ref=other.driver.id)

    assert own.match is not None and own.match.id == seed["driver"].id
    assert foreign.status == "not_found"


async def test_resolve_vehicle_by_registration_and_type(seed: dict, db_session: AsyncSession) -> None:
    trailer = new_vehicle(seed["org"].id, VehicleType.TRAILER)
    trailer.registration = "CA 123-456"
    db_session.add(trailer)
    await db_session.flush()

    by_text = await resolve_vehicle(db_session, organization_id=seed["org"].id, text="ca123456")
    as_horse = await resolve_vehicle(
        db_session, organization_id=seed["org"].id, text="ca123456", vehicle_type=VehicleType.HORSE,
    )

    assert by_text.match is not None
    assert (by_text.match.id, by_text.match.detail) == (trailer.id, "trailer")
    assert as_horse.status == "not_found"


async def test_resolve_vehicle_never_matches_another_orgs_plate(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)

    resolution = await resolve_vehicle(db_session, organization_id=seed["org"].id, text=other.horse.registration)

    assert resolution.status == "not_found"


async def test_resolve_precinct_own_and_shared_only(seed: dict, db_session: AsyncSession) -> None:
    other = await other_operator(db_session)
    tag = uuid.uuid4().hex[:6]
    own = Precinct(
        id=uuid.uuid4(), name=f"City Deep {tag}", principal_organization_id=seed["org"].id,
        latitude="0", longitude="0", address="City Deep, Johannesburg",
    )
    shared = Precinct(
        id=uuid.uuid4(), name=f"Shared Hub {tag}", principal_organization_id=other.org.id,
        latitude="0", longitude="0", is_shared=True,
    )
    private = Precinct(
        id=uuid.uuid4(), name=f"Private Yard {tag}", principal_organization_id=other.org.id,
        latitude="0", longitude="0",
    )
    db_session.add_all([own, shared, private])
    await db_session.flush()

    found_own = await resolve_precinct(db_session, organization_id=seed["org"].id, text=f"City Deep {tag}")
    found_shared = await resolve_precinct(db_session, organization_id=seed["org"].id, text=f"Shared Hub {tag}")
    hidden = await resolve_precinct(db_session, organization_id=seed["org"].id, text=f"Private Yard {tag}")

    assert found_own.match is not None and found_own.match.id == own.id
    assert found_shared.match is not None and found_shared.match.id == shared.id
    assert hidden.status == "not_found"


async def test_resolve_trip_by_suffix_within_the_org(seed: dict, db_session: AsyncSession) -> None:
    operator = operator_from_seed(seed)
    trip = (await seed_trip(db_session, operator, stops=[seed["origin"], seed["dest"]], start=days_ago(1))).trip
    other = await other_operator(db_session)
    suffix = trip.trip_reference[-8:].lower()

    found = await resolve_trip(db_session, organization_id=seed["org"].id, text=suffix)
    elsewhere = await resolve_trip(db_session, organization_id=other.org.id, text=trip.trip_reference)

    assert found.match is not None and found.match.id == trip.id
    assert elsewhere.status == "not_found"
