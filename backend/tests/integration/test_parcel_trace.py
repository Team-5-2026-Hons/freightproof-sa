"""FP-149: real Postgres lookup, archive membership, tenant isolation and read projection."""

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.enums import OrganizationType, PhaseStatus, PhaseType, TripStatus, VehicleType
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.orchestration.parcel_trace.service import trace_parcel
from app.schemas.parcel_trace import ParcelTraceQuery
from tests.conftest import auth_header, make_token

BARCODE = "0000123/a"


@dataclass
class TraceWorld:
    org: Organization
    user: User
    trip: Trip
    cargo: Consignment
    parcel: Parcel
    phases: list[PhaseEvent]


@pytest_asyncio.fixture(autouse=True)
async def override_db(db_session: AsyncSession) -> AsyncGenerator[None, None]:
    async def dependency() -> AsyncGenerator[AsyncSession, None]:
        yield db_session
    app.dependency_overrides[get_db] = dependency
    yield
    app.dependency_overrides.pop(get_db, None)


async def make_world(db: AsyncSession, reference: str, *, barcode: str = BARCODE) -> TraceWorld:
    now = datetime.now(UTC)
    org = Organization(id=uuid4(), name=reference, org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(id=uuid4(), organization_id=org.id, email=f"{uuid4()}@test.co.za", full_name="Trace Dispatcher")
    driver = Driver(id=uuid4(), organization_id=org.id, full_name="Trace Driver", id_number=uuid4().hex[:13], phone_number="+27000000000", license_number=str(uuid4()))
    horse = Vehicle(id=uuid4(), organization_id=org.id, registration=str(uuid4()), vehicle_type=VehicleType.HORSE, pulsit_device_id=str(uuid4()))
    precincts = [Precinct(id=uuid4(), principal_organization_id=org.id, name=name, latitude=Decimal("-26.1"), longitude=Decimal("28.1")) for name in ("Origin Depot", "Destination Depot")]
    db.add_all([user, driver, horse, *precincts])
    await db.flush()
    trip = Trip(id=uuid4(), trip_reference=str(uuid4()), operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
                created_by_user_id=user.id, status=TripStatus.ACTIVE, current_phase="confirmation", current_stop=99,
                created_at=now - timedelta(days=1))
    db.add(trip)
    await db.flush()
    stops = [TripStop(id=uuid4(), trip_id=trip.id, precinct_id=p.id, sequence=index) for index, p in enumerate(precincts)]
    db.add_all(stops)
    await db.flush()
    cargo = Consignment(id=uuid4(), trip_id=trip.id, parcel_perfect_reference=reference, pickup_stop_id=stops[0].id, delivery_stop_id=stops[1].id)
    db.add(cargo)
    await db.flush()
    parcel = Parcel(id=uuid4(), consignment_id=cargo.id, barcode=barcode, status="scanned_out", pp_scan_out_at=now - timedelta(hours=2))
    types = list(PhaseType)
    phases = [PhaseEvent(
        id=uuid4(), trip_id=trip.id, trip_stop_id=None if index == 0 else stops[0 if index < 5 else 1].id,
        phase_type=kind, sequence_number=index,
        status=PhaseStatus.COMPLETED if index < 4 else PhaseStatus.PENDING,
        anchor_status="anchored" if index < 4 else "pending",
        completed_at=now - timedelta(hours=1, minutes=10-index) if index < 4 else None,
        created_at=now - timedelta(days=1),
    ) for index, kind in enumerate(types)]
    phases[3].seal_number = "SEAL-001"
    phases[3].horse_gps_lat = Decimal("-26.1")
    phases[3].horse_gps_lng = Decimal("28.1")
    phases[3].pulsit_geofence_confirmed = True
    db.add_all([parcel, *phases])
    await db.flush()
    return TraceWorld(org, user, trip, cargo, parcel, phases)


@pytest_asyncio.fixture
async def world(db_session: AsyncSession) -> TraceWorld:
    return await make_world(db_session, f"WB-{uuid4()}")


def headers(world: TraceWorld, role: str = "dispatcher") -> dict[str, str]:
    return auth_header(make_token(sub=str(world.user.id), role=role, org_id=str(world.org.id)))


def trace_params(world: TraceWorld) -> dict[str, str]:
    return {"barcode": world.parcel.barcode, "waybill_reference": world.cargo.parcel_perfect_reference}


@pytest.mark.parametrize("role", ["dispatcher", "admin_dispatcher"])
async def test_any_dispatcher_can_search_and_derive_progress_without_cached_position(
    client: AsyncClient, world: TraceWorld, role: str,
) -> None:
    lookup = await client.get("/api/v1/parcels/lookup", params={"barcode": f"  {BARCODE}  "}, headers=headers(world, role))
    trace = await client.get("/api/v1/parcels/trace", params=trace_params(world), headers=headers(world, role))

    assert lookup.status_code == trace.status_code == 200
    assert lookup.json()["items"] == [{"waybill_reference": world.cargo.parcel_perfect_reference, "journey_count": 1}]
    journey = trace.json()["journeys"][0]
    assert journey["progress"]["phase_type"] == "in_transit"
    assert journey["progress"]["position"] == "within_journey"
    assert len(journey["phases"]) == len(world.phases)
    assert journey["phases"][4]["completed_at"] is None
    assert journey["last_recorded_location"]["captured_at"] is None
    assert journey["scans"][0]["source"] == "parcel_record_source_unknown"
    assert "data_hash" not in trace.text and "payload_json" not in trace.text


async def test_lookup_preserves_case_and_does_not_wildcard(
    client: AsyncClient, world: TraceWorld,
) -> None:
    for query in (BARCODE.upper(), "%", "123/a"):
        response = await client.get("/api/v1/parcels/lookup", params={"barcode": query}, headers=headers(world))
        assert response.status_code == 200
        assert response.json()["items"] == []


async def test_foreign_and_unknown_records_are_indistinguishable(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    foreign = await make_world(db_session, f"OTHER-{uuid4()}", barcode="foreign-only")
    for query in ("foreign-only", "not-known"):
        response = await client.get("/api/v1/parcels/lookup", params={"barcode": query}, headers=headers(world))
        assert response.json()["items"] == []
    response = await client.get("/api/v1/parcels/trace", params=trace_params(foreign), headers=headers(world, "admin_dispatcher"))
    assert response.status_code == 404


@pytest.mark.parametrize("role", ["driver", "client_viewer"])
async def test_driver_and_client_cannot_read_parcel_data(client: AsyncClient, world: TraceWorld, role: str) -> None:
    for path, params in (("lookup", {"barcode": BARCODE}), ("trace", trace_params(world))):
        response = await client.get(f"/api/v1/parcels/{path}", params=params, headers=headers(world, role))
        assert response.status_code == 403


async def test_missing_and_invalid_credentials_are_rejected(client: AsyncClient, world: TraceWorld) -> None:
    params = {"barcode": BARCODE}
    missing = await client.get("/api/v1/parcels/lookup", params=params)
    invalid = await client.get("/api/v1/parcels/lookup", params=params, headers={"Authorization": "Bearer invalid"})
    assert missing.status_code == 403
    assert invalid.status_code == 401


@pytest.mark.parametrize("barcode", ["", "   ", "x" * 101, "12\u200b3", "12\n3"])
async def test_invalid_barcodes_are_422(client: AsyncClient, world: TraceWorld, barcode: str) -> None:
    response = await client.get("/api/v1/parcels/lookup", params={"barcode": barcode}, headers=headers(world))
    assert response.status_code == 422


async def test_trace_rejects_invalid_cursor(client: AsyncClient, world: TraceWorld) -> None:
    response = await client.get("/api/v1/parcels/trace", params={**trace_params(world), "cursor": "bad"}, headers=headers(world))
    assert response.status_code == 422


async def test_lookup_returns_distinct_waybills_for_duplicate_barcode(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    cargo = Consignment(id=uuid4(), trip_id=world.trip.id, parcel_perfect_reference=f"OTHER-{uuid4()}")
    db_session.add(cargo)
    await db_session.flush()
    db_session.add_all([
        Parcel(id=uuid4(), consignment_id=cargo.id, barcode=BARCODE),
        Parcel(id=uuid4(), consignment_id=world.cargo.id, barcode=BARCODE),
    ])
    await db_session.flush()
    response = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE}, headers=headers(world))
    assert len(response.json()["items"]) == 2
    assert all(item["journey_count"] == 1 for item in response.json()["items"])


async def add_archive(db: AsyncSession, world: TraceWorld) -> Trip:
    old = Trip(id=uuid4(), trip_reference=str(uuid4()), operator_organization_id=world.org.id,
               driver_id=world.trip.driver_id, horse_id=world.trip.horse_id, created_by_user_id=world.user.id,
               status=TripStatus.CANCELLED, created_at=world.trip.created_at - timedelta(days=1))
    db.add(old)
    await db.flush()
    db.add(PhaseEvent(id=uuid4(), trip_id=old.id, phase_type=PhaseType.TRIP_CREATION,
                     sequence_number=0, status=PhaseStatus.COMPLETED,
                     parcel_manifest_snapshot={"waybills": [{
                         "details": {"waybill": world.cargo.parcel_perfect_reference, "receiver_contact": "DO-NOT-EXPOSE"},
                         "tracks": [{"trackno": BARCODE}],
                     }]}))
    await db.flush()
    return old


async def test_cancelled_history_survives_in_creation_snapshot_and_paginates(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    old = await add_archive(db_session, world)
    lookup = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE}, headers=headers(world))
    assert lookup.json()["items"][0]["journey_count"] == 2
    first = await client.get("/api/v1/parcels/trace", params={**trace_params(world), "limit": 1}, headers=headers(world))
    assert first.status_code == 200
    assert first.json()["journeys"][0]["trip_id"] == str(world.trip.id)
    second = await client.get("/api/v1/parcels/trace", params={**trace_params(world), "limit": 1, "cursor": first.json()["next_cursor"]}, headers=headers(world))
    historical = second.json()["journeys"][0]
    assert historical["trip_id"] == str(old.id)
    assert historical["membership_source"] == "creation_manifest"
    assert historical["scans"] == []
    assert historical["progress"]["position"] == "cancelled"
    assert second.json()["next_cursor"] is None
    assert "DO-NOT-EXPOSE" not in second.text


async def test_snapshot_only_barcode_is_searchable_and_old_shapes_do_not_crash(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    old = await add_archive(db_session, world)
    await db_session.delete(world.parcel)
    world.phases[0].parcel_manifest_snapshot = {"waybills": "legacy-shape"}
    await db_session.flush()
    response = await client.get("/api/v1/parcels/trace", params={"barcode": BARCODE, "waybill_reference": world.cargo.parcel_perfect_reference}, headers=headers(world))
    assert response.status_code == 200
    assert [j["trip_id"] for j in response.json()["journeys"]] == [str(old.id)]


async def test_only_matching_cargo_and_shared_trip_exceptions_are_returned(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    other = Consignment(id=uuid4(), trip_id=world.trip.id, parcel_perfect_reference=f"OTHER-{uuid4()}")
    db_session.add(other)
    await db_session.flush()
    for cargo_id, description in ((world.cargo.id, "Our cargo"), (None, "Shared trip"), (other.id, "Other cargo")):
        db_session.add(TripException(id=uuid4(), trip_id=world.trip.id, consignment_id=cargo_id,
                                    exception_type="parcel_count_mismatch", source="system", severity="warning", description=description))
    await db_session.flush()
    response = await client.get("/api/v1/parcels/trace", params=trace_params(world), headers=headers(world))
    findings = response.json()["journeys"][0]["exceptions"]
    assert {f["description"] for f in findings} == {"Our cargo", "Shared trip"}


async def test_trace_does_not_write_or_recompute_trip_state(db_session: AsyncSession, world: TraceWorld) -> None:
    before = [(p.id, p.status, p.completed_at) for p in world.phases]
    query = ParcelTraceQuery(**trace_params(world))
    await trace_parcel(db_session, organization_id=world.org.id, query=query)

    assert not db_session.new and not db_session.dirty and not db_session.deleted
    assert world.trip.current_phase == "confirmation"
    assert world.trip.current_stop == 99
    assert before == [(p.id, p.status, p.completed_at) for p in world.phases]
    assert all(not inspect(p).modified for p in world.phases)
    assert len((await db_session.execute(select(PhaseEvent).where(PhaseEvent.trip_id == world.trip.id))).scalars().all()) == len(before)


async def test_foreign_snapshot_does_not_reveal_its_waybill(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    foreign = await make_world(db_session, f"PRIVATE-{uuid4()}", barcode="another-barcode")
    await add_archive(db_session, foreign)
    # The archived snapshot contains BARCODE, but only the foreign operator can see it.
    response = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE}, headers=headers(world))
    assert [row["waybill_reference"] for row in response.json()["items"]] == [world.cargo.parcel_perfect_reference]
    response = await client.get("/api/v1/parcels/trace", params={"barcode": BARCODE, "waybill_reference": foreign.cargo.parcel_perfect_reference}, headers=headers(world))
    assert response.status_code == 404


async def test_barcode_in_one_waybill_does_not_match_another_waybill_in_same_snapshot(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    world.phases[0].parcel_manifest_snapshot = {"waybills": [
        {"details": {"waybill": world.cargo.parcel_perfect_reference}, "tracks": [{"trackno": BARCODE}]},
        {"details": {"waybill": "UNRELATED"}, "tracks": [{"trackno": "different"}]},
    ]}
    await db_session.flush()
    response = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE}, headers=headers(world))
    assert response.json()["items"] == [{"waybill_reference": world.cargo.parcel_perfect_reference, "journey_count": 1}]


async def test_lookup_paginates_ambiguous_matches_without_truncating_them(
    client: AsyncClient, db_session: AsyncSession, world: TraceWorld,
) -> None:
    references = [f"TRACE-{i:02d}-{uuid4().hex[:6]}" for i in range(22)]
    for reference in references:
        cargo = Consignment(id=uuid4(), trip_id=world.trip.id, parcel_perfect_reference=reference)
        db_session.add(cargo)
        await db_session.flush()
        db_session.add(Parcel(id=uuid4(), consignment_id=cargo.id, barcode=BARCODE))
    await db_session.flush()
    first = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE}, headers=headers(world))
    assert len(first.json()["items"]) == 20
    second = await client.get("/api/v1/parcels/lookup", params={"barcode": BARCODE, "after": first.json()["next_after"]}, headers=headers(world))
    combined = first.json()["items"] + second.json()["items"]
    assert len(combined) == 23
    assert {row["waybill_reference"] for row in combined} == {*references, world.cargo.parcel_perfect_reference}
    assert second.json()["next_after"] is None


async def test_trace_batches_queries_for_multiple_journeys(db_session: AsyncSession, world: TraceWorld) -> None:
    await add_archive(db_session, world)
    await add_archive(db_session, world)
    query = ParcelTraceQuery(**trace_params(world))
    with patch.object(db_session, "execute", wraps=db_session.execute) as execute:
        response = await trace_parcel(db_session, organization_id=world.org.id, query=query)
    assert len(response.journeys) == 3
    # One trip query and five batched record reads, regardless of the number of journeys.
    assert execute.call_count == 6
