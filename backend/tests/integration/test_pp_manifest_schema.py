"""DB-level rules for the PP manifest key and precinct hub codes (FP-281, spec §7).

The partial unique index and the check constraint decide these rules, not application
code, so they are asserted against the real Postgres schema (create_all)."""

from sqlalchemy.ext.asyncio import AsyncSession

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models.enums import OrganizationType, TripStatus
from app.db.models.organisations import PP_HUB_CODE_INDEX, Organization, Precinct
from app.db.models.trips import PP_MANIFEST_CHECK, PP_MANIFEST_INDEX
from app.orchestration.integrity import violated_constraint
from tests.integration._pp_manifest_world import build_manifest_world, insert_trip


async def test_second_live_trip_for_one_manifest_is_rejected(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=81)

    with pytest.raises(IntegrityError) as exc:
        await insert_trip(db_session, world, number=81)

    assert violated_constraint(exc.value) == PP_MANIFEST_INDEX


async def test_closed_trip_still_owns_its_manifest(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=81, status=TripStatus.CLOSED)

    with pytest.raises(IntegrityError) as exc:
        await insert_trip(db_session, world, number=81)

    assert violated_constraint(exc.value) == PP_MANIFEST_INDEX


async def test_cancelled_trip_frees_its_manifest(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=81, status=TripStatus.CANCELLED)

    replacement = await insert_trip(db_session, world, number=81)

    assert replacement.pp_manifest_number == 81


async def test_trips_without_a_manifest_never_collide(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    await insert_trip(db_session, world, number=None)

    second = await insert_trip(db_session, world, number=None)

    assert second.pp_manifest_number is None


async def test_partial_manifest_key_is_rejected(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    trip = await insert_trip(db_session, world, number=None)
    trip.pp_manifest_number = 81  # number without issuer and hub

    with pytest.raises(IntegrityError) as exc:
        await db_session.flush()

    assert violated_constraint(exc.value) == PP_MANIFEST_CHECK


async def test_hub_code_is_unique_per_principal(db_session: AsyncSession) -> None:
    world = await build_manifest_world(db_session)
    duplicate = Precinct(
        id=uuid.uuid4(), name="Second Cape Town", principal_organization_id=world.client.id,
        latitude="0", longitude="0", pp_hub_code="CPT",
    )
    db_session.add(duplicate)

    with pytest.raises(IntegrityError) as exc:
        await db_session.flush()

    assert violated_constraint(exc.value) == PP_HUB_CODE_INDEX


async def test_same_hub_code_under_another_principal_is_allowed(db_session: AsyncSession) -> None:
    await build_manifest_world(db_session)
    other_client = Organization(id=uuid.uuid4(), name="FedEx", org_type=OrganizationType.PRINCIPAL)
    db_session.add(other_client)
    await db_session.flush()
    other_cape_town = Precinct(
        id=uuid.uuid4(), name="FedEx Cape Town", principal_organization_id=other_client.id,
        latitude="0", longitude="0", pp_hub_code="CPT",
    )
    db_session.add(other_cape_town)

    await db_session.flush()

    assert other_cape_town.pp_hub_code == "CPT"
