"""Concurrency proofs for trip creation (FP-138 and FP-281).

Two dispatchers act at the same instant on something only one of them can have —
a Parcel Perfect waybill or manifest. Exactly one must win; the
other must be told. These tests exist to *prove* that, not to reason about it —
a race you have only argued about is a race you cannot show you fixed.

Each one failed against the unfixed code before its guard was written. That is the
point of the file: passing proves the guard works, and the recorded failure proves
the test was capable of catching its absence.

Why this file does not use the `db_session` fixture
---------------------------------------------------
`db_session` (tests/conftest.py) binds one AsyncSession to a single connection
inside one outer transaction, with join_transaction_mode="create_savepoint", and
rolls the whole thing back at teardown. That is exactly right for every other
integration test and exactly useless here: two sessions built on it would sit
*inside the same transaction*, so there is no lock contention, no cross-
transaction unique violation, and no race to observe. A test written that way
would pass against the unfixed code and prove nothing.

So these tests open their own AsyncSessions on independent connections, run real
transactions that really COMMIT, and clean up after themselves explicitly —
the rollback trick is not available once you are committing for real.

The races
---------
Three, and they are genuinely different — which is why no single guard covers them:

  1. INSERT/INSERT on a waybill — both callers SELECT, both find nothing, both
     INSERT. A row lock cannot help: there is no row yet to lock. Only the unique
     constraint on parcel_perfect_reference stops this.

  2. UPDATE/UPDATE on a waybill — a Consignment row already exists with trip_id
     NULL (a prior sync, or an unassigned waybill). Both callers read trip_id=None,
     both pass the reassignment guard, both write their own trip_id, and the last
     writer silently wins. The unique constraint never fires — one row, two UPDATEs.
     Only SELECT ... FOR UPDATE stops this.

  3. Manifest — both callers clear the preview-time check before either inserts;
     stopped by uq_trips_pp_manifest.

Determinism, and where the barrier goes
---------------------------------------
Both callers are parked on an asyncio.Barrier and released together, so they enter
the contended window at the same moment. Every subsequent `await db.execute(...)`
is a real asyncpg round trip that suspends the task, so they step through it in
lockstep. Without that, the interleaving depends on timing, and a flaky proof is
not a proof.

The barrier must sit BEFORE the contended resource, at a point both callers are
guaranteed to reach. Put it after, and the test deadlocks rather than fails: the
winner parks waiting for a partner who is already blocked in Postgres on the
winner's own lock. That is why the waybill races synchronise on the PP fetch while
the manifest race (Task 9) synchronises on its pre-check.
"""

import asyncio
import dataclasses
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from pytest import MonkeyPatch
from typing import Any

from app.blockchain.hedera import HederaReceipt
from app.core.exceptions import ConsignmentAlreadyAssignedError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType,
    IdvsStatus,
    OrganizationType,
    TripStatus,
    VehicleType,
)
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.sessions import UserSession
from app.db.models.trips import Consignment, Parcel, Trip, TripStop, TripTrailer
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.crypto.hashing import compute_snapshot_sha256
from app.orchestration.consignments import manifest_import as consignments_manifest_import
from app.orchestration.pp_manifest import manifest_snapshot
from app.integrations.parcel_perfect import (
    PPManifestHeader, PPManifestResponse,
    PPContents,
    PPTrack,
    PPWaybillDetails,
    PPWaybillResponse,
)
from app.main import app
from app.orchestration.consignment_service import fetch_and_sync_consignment
from tests.conftest import auth_header, make_token

# Two callers, released together. Named rather than inlined because both tests
# depend on the party count matching the number of racing tasks exactly — a
# mismatch hangs the test rather than failing it.
_RACERS = 2


def _make_waybill(pp_reference: str) -> PPWaybillResponse:
    """A minimal two-parcel waybill.

    accnum is left empty on purpose: fetch_and_sync_consignment only queries for
    an Organization when accnum is truthy, so this keeps the test focused on the
    race instead of dragging client-org attribution into it.
    """
    return PPWaybillResponse(
        details=PPWaybillDetails(
            waybill=pp_reference,
            waydate="01.06.2026",
            pieces=2,
            duedate="03.06.2026",
            declared_value=500.00,
            dest_address="1 Main St",
            dest_town="CAPE TOWN",
            dest_person="Test Receiver",
            dest_contact="0210000001",
            orig_person="Test Shipper",
            orig_town="JOHANNESBURG",
            orig_address="1 Test St",
            service="ONX",
            actual_weight_kg=5.0,
            freight_total=None,
            poddate="",
            failtype=None,
            client_reference="REF001",
        ),
        contents=[PPContents(item=1, description="Electronics", actmass=5.0, pieces=2)],
        tracks=[
            PPTrack(trackno=f"{pp_reference}0001", parcelno=1, item=1),
            PPTrack(trackno=f"{pp_reference}0002", parcelno=2, item=1),
        ],
        wayrefs=[],
    )


class _BarrierPPClient:
    """PP client stub that holds every caller until all of them have arrived.

    Standing in for the network call is what makes the race reproducible: both
    callers leave this method at the same moment, immediately before the
    unguarded SELECT that FP-138 is about.
    """

    def __init__(self, barrier: asyncio.Barrier) -> None:
        self._barrier = barrier

    async def get_single_waybill(self, waybill_number: str) -> PPWaybillResponse:
        await self._barrier.wait()
        # Serves whatever reference is asked for. The order-number race needs the two
        # callers to cite DIFFERENT waybills, so that the waybill constraint (FP-138)
        # cannot be what refuses the loser — otherwise the test would pass without the
        # order-number guard existing at all.
        return _make_waybill(waybill_number)


@pytest_asyncio.fixture
async def racing_world(test_engine, monkeypatch):
    """Two trips and their scaffolding, committed for real, plus a fresh waybill.

    Committed rather than held in an open transaction because the racing sessions
    are separate connections — anything uncommitted here would be invisible to
    them. Every identifier is uuid-derived so a previous failed run cannot
    collide with this one, and teardown removes exactly what was created.
    """
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:8]
    pp_reference = f"RACE{suffix.upper()}"

    org = Organization(
        id=uuid.uuid4(), name=f"Racing Op {suffix}", org_type=OrganizationType.OPERATOR
    )
    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"dispatcher-{suffix}@test.co.za", full_name="Dispatcher",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number=f"80010150{suffix[:5]}", phone_number=f"+2782{suffix[:7]}",
        license_number=f"DRV-{suffix}",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration=f"R{suffix.upper()}", pulsit_device_id=f"PUL-{suffix}",
    )
    trips = [
        Trip(
            id=uuid.uuid4(), trip_reference=f"FP-{suffix}-{n}", order_number=f"ORD-{suffix}-{n}",
            operator_organization_id=org.id, driver_id=driver.id, horse_id=horse.id,
            status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
            created_by_user_id=user.id,
        )
        for n in ("A", "B")
    ]

    async with sessionmaker() as session:
        session.add(org)
        await session.flush()
        session.add_all([user, driver, horse])
        await session.flush()
        session.add_all(trips)
        await session.commit()

    # One client over one barrier, shared by both callers. Building it inside the
    # lambda instead would hand each caller a private barrier of two parties, and
    # both would wait forever for a partner that never arrives.
    pp_client = _BarrierPPClient(asyncio.Barrier(_RACERS))
    monkeypatch.setattr(
        "app.orchestration.consignments.sync.get_pp_client", lambda: pp_client
    )

    yield {
        "sessionmaker": sessionmaker,
        "pp_reference": pp_reference,
        "trip_a": trips[0],
        "trip_b": trips[1],
    }

    async with sessionmaker() as session:
        consignment_ids = (
            await session.execute(
                select(Consignment.id).where(
                    Consignment.parcel_perfect_reference == pp_reference
                )
            )
        ).scalars().all()
        if consignment_ids:
            await session.execute(
                delete(Parcel).where(Parcel.consignment_id.in_(consignment_ids))
            )
            await session.execute(delete(Consignment).where(Consignment.id.in_(consignment_ids)))
        await session.execute(delete(Trip).where(Trip.id.in_([t.id for t in trips])))
        await session.execute(delete(Vehicle).where(Vehicle.id == horse.id))
        await session.execute(delete(Driver).where(Driver.id == driver.id))
        await session.execute(delete(User).where(User.id == user.id))
        await session.execute(delete(Organization).where(Organization.id == org.id))
        await session.commit()


async def _claim(sessionmaker, pp_reference: str, trip_id: uuid.UUID) -> None:
    """One dispatcher's attempt: its own session, its own transaction, real commit."""
    async with sessionmaker() as session:
        await fetch_and_sync_consignment(session, pp_reference, trip_id=trip_id)
        await session.commit()


async def _consignments_for(sessionmaker, pp_reference: str) -> list[Consignment]:
    """Read the committed truth from a third, uninvolved session."""
    async with sessionmaker() as session:
        return list(
            (
                await session.execute(
                    select(Consignment).where(
                        Consignment.parcel_perfect_reference == pp_reference
                    )
                )
            ).scalars().all()
        )


async def test_concurrent_claims_on_new_waybill_yield_one_consignment(racing_world):
    """INSERT/INSERT: two dispatchers claim an unseen waybill at the same instant.

    Both callers pass the select-then-insert window together, so nothing in
    Python can separate them — only a database constraint can. Exactly one trip
    must end up owning the cargo, and the loser must be told so.
    """
    sessionmaker = racing_world["sessionmaker"]
    pp_reference = racing_world["pp_reference"]

    outcomes = await asyncio.gather(
        _claim(sessionmaker, pp_reference, racing_world["trip_a"].id),
        _claim(sessionmaker, pp_reference, racing_world["trip_b"].id),
        return_exceptions=True,
    )

    rows = await _consignments_for(sessionmaker, pp_reference)
    assert len(rows) == 1, (
        f"waybill {pp_reference} landed on {len(rows)} consignment rows "
        f"(trip_ids={[r.trip_id for r in rows]}) — the same cargo is on two trips"
    )

    failures = [o for o in outcomes if isinstance(o, BaseException)]
    assert len(failures) == 1, f"expected exactly one refusal, got {outcomes}"
    assert isinstance(failures[0], ConsignmentAlreadyAssignedError), (
        f"loser was refused with {type(failures[0]).__name__}: {failures[0]}"
    )
    assert rows[0].trip_id in {racing_world["trip_a"].id, racing_world["trip_b"].id}


async def test_concurrent_claims_on_unassigned_consignment_yield_one_owner(racing_world):
    """UPDATE/UPDATE: the row already exists, unassigned, and both callers claim it.

    The unique index is blind to this — one row, two UPDATEs — so it is the row
    lock that has to hold the line. Without it both callers read trip_id=None,
    both pass the reassignment guard, and the later write silently overwrites the
    earlier one: the first trip loses its cargo without anyone being told.
    """
    sessionmaker = racing_world["sessionmaker"]
    pp_reference = racing_world["pp_reference"]

    async with sessionmaker() as session:
        session.add(
            Consignment(
                id=uuid.uuid4(), parcel_perfect_reference=pp_reference, trip_id=None
            )
        )
        await session.commit()

    outcomes = await asyncio.gather(
        _claim(sessionmaker, pp_reference, racing_world["trip_a"].id),
        _claim(sessionmaker, pp_reference, racing_world["trip_b"].id),
        return_exceptions=True,
    )

    rows = await _consignments_for(sessionmaker, pp_reference)
    assert len(rows) == 1, f"expected the pre-existing row only, got {len(rows)}"

    failures = [o for o in outcomes if isinstance(o, BaseException)]
    assert len(failures) == 1, (
        f"expected exactly one refusal, got {outcomes} — both dispatchers were told "
        f"they had the cargo, but it sits on trip {rows[0].trip_id}"
    )
    assert isinstance(failures[0], ConsignmentAlreadyAssignedError), (
        f"loser was refused with {type(failures[0]).__name__}: {failures[0]}"
    )


# ── FP-172: the same race through the real endpoint ──────────────────────────


@pytest_asyncio.fixture
async def racing_api_world(test_engine, monkeypatch):
    """Everything POST /trips needs, committed, plus a per-request session factory.

    The autouse override in test_trips.py hands every request one shared session,
    which is the right call there and fatal here — two requests inside one
    transaction cannot race. This override mirrors production get_db instead: a
    fresh session and a real transaction per request, committed on success and
    rolled back on error.
    """
    sessionmaker = async_sessionmaker(test_engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:8]
    pp_reference = f"APIRACE{suffix.upper()}"

    operator = Organization(
        id=uuid.uuid4(), name=f"Op {suffix}", org_type=OrganizationType.OPERATOR
    )
    principal = Organization(
        id=uuid.uuid4(), name=f"Client {suffix}", org_type=OrganizationType.PRINCIPAL
    )
    # Two dispatchers, not one on two tabs. Authentication stamps a UserSession row
    # per request and sweeps that user's older rows on a new session
    # (auth/sessions.py), so two concurrent requests from ONE user contend on those
    # rows: the first holds them while parked at the barrier, the second blocks in
    # Postgres and can never reach it. Two users removes that entirely — and it is
    # the scenario the ticket actually describes.
    user = User(
        id=uuid.uuid4(), organization_id=operator.id,
        email=f"api-dispatcher-a-{suffix}@test.co.za", full_name="Dispatcher A", is_active=True,
    )
    user_b = User(
        id=uuid.uuid4(), organization_id=operator.id,
        email=f"api-dispatcher-b-{suffix}@test.co.za", full_name="Dispatcher B", is_active=True,
    )
    origin = Precinct(
        id=uuid.uuid4(), name=f"Origin {suffix}", principal_organization_id=principal.id,
        latitude="33.9249", longitude="18.4241",
    )
    destination = Precinct(
        id=uuid.uuid4(), name=f"Dest {suffix}", principal_organization_id=principal.id,
        latitude="26.2041", longitude="28.0473",
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=operator.id, full_name="Driver",
        id_number=f"80010150{suffix[:5]}", phone_number=f"+2782{suffix[:7]}",
        license_number=f"DRV-{suffix}", idvs_status=IdvsStatus.PENDING,
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.HORSE,
        registration=f"H{suffix.upper()}", pulsit_device_id=f"PUL-H-{suffix}",
    )
    trailer = Vehicle(
        id=uuid.uuid4(), organization_id=operator.id, vehicle_type=VehicleType.TRAILER,
        registration=f"T{suffix.upper()}", pulsit_device_id=f"PUL-T-{suffix}",
    )

    async with sessionmaker() as session:
        session.add_all([operator, principal])
        await session.flush()
        session.add_all([user, user_b, origin, destination, driver, horse, trailer])
        await session.commit()

    async def _get_db():
        async with sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = _get_db
    pp_client = _BarrierPPClient(asyncio.Barrier(_RACERS))
    monkeypatch.setattr(
        "app.orchestration.consignments.sync.get_pp_client", lambda: pp_client
    )

    yield {
        "principal": principal,
        "origin": origin,
        "destination": destination,
        "suffix": suffix,
        "sessionmaker": sessionmaker,
        "pp_reference": pp_reference,
        "org": operator,
        "user": user,
        "user_b": user_b,
        "payload_base": {
            "driver_id": str(driver.id),
            "horse_id": str(horse.id),
            "trailer_ids": [str(trailer.id)],
            "origin_precinct_id": str(origin.id),
            "destination_precinct_id": str(destination.id),
            "planned_departure_at": datetime.now(UTC).isoformat(),
            "consignments": [{"pp_reference": pp_reference, "unit_count_expected": 2}],
        },
    }

    app.dependency_overrides.pop(get_db, None)

    async with sessionmaker() as session:
        trip_ids = (
            await session.execute(
                select(Trip.id).where(Trip.operator_organization_id == operator.id)
            )
        ).scalars().all()
        # Match every waybill owned by this run, including the manifest race.
        consignment_ids = (
            await session.execute(
                select(Consignment.id).where(
                    Consignment.parcel_perfect_reference.like(f"%{suffix.upper()}%")
                )
            )
        ).scalars().all()
        if consignment_ids:
            await session.execute(
                delete(Parcel).where(Parcel.consignment_id.in_(consignment_ids))
            )
            await session.execute(delete(Consignment).where(Consignment.id.in_(consignment_ids)))
        if trip_ids:
            # PhaseEvent before BlockchainReceipt: phase rows carry an FK to the
            # receipt that anchored them.
            await session.execute(delete(PhaseEvent).where(PhaseEvent.trip_id.in_(trip_ids)))
            await session.execute(
                delete(BlockchainReceipt).where(BlockchainReceipt.trip_id.in_(trip_ids))
            )
            await session.execute(delete(TripTrailer).where(TripTrailer.trip_id.in_(trip_ids)))
            await session.execute(delete(TripStop).where(TripStop.trip_id.in_(trip_ids)))
            await session.execute(delete(Trip).where(Trip.id.in_(trip_ids)))
        await session.execute(
            delete(Vehicle).where(Vehicle.id.in_([horse.id, trailer.id]))
        )
        await session.execute(delete(Driver).where(Driver.id == driver.id))
        # Authenticating stamps a UserSession row per dispatcher (auth/sessions.py),
        # and it outlives the request that created it — so it has to go before the
        # users it points at.
        await session.execute(
            delete(UserSession).where(UserSession.user_id.in_([user.id, user_b.id]))
        )
        await session.execute(delete(User).where(User.id.in_([user.id, user_b.id])))
        await session.execute(
            delete(Precinct).where(Precinct.id.in_([origin.id, destination.id]))
        )
        await session.execute(
            delete(Organization).where(Organization.id.in_([operator.id, principal.id]))
        )
        await session.commit()


async def test_concurrent_trip_creation_anchors_one_journey_lock(
    client: AsyncClient, racing_api_world
):
    """Two dispatchers, two orders, one waybill, at the same moment.

    The whole point of FP-138 in one assertion: the loser must be refused before
    anything of theirs reaches Hedera. A journey-lock hash is anchored to an
    append-only ledger, so a second one over the same cargo is not a duplicate row
    that can be cleaned up later — it is a permanent contradiction in the evidence
    record. One 201, one 409, one consignment, one anchor.
    """
    world = racing_api_world
    headers_a, headers_b = (
        auth_header(make_token(sub=str(u.id), role="dispatcher", org_id=str(world["org"].id)))
        for u in (world["user"], world["user_b"])
    )
    fake_receipt = HederaReceipt(
        topic_id="0.0.12345", sequence_number=42,
        consensus_timestamp=None, transaction_id="0.0.12345@1715865600.0",
    )

    def _payload(order_number: str) -> dict:
        return {**world["payload_base"], "order_number": order_number}

    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        instance = MagicMock()
        instance.submit_hash.return_value = fake_receipt
        MockService.return_value = instance

        first, second = await asyncio.gather(
            client.post("/api/v1/trips", json=_payload(f"ORD-{world['pp_reference']}-A"),
                        headers=headers_a),
            client.post("/api/v1/trips", json=_payload(f"ORD-{world['pp_reference']}-B"),
                        headers=headers_b),
        )

    statuses = sorted([first.status_code, second.status_code])
    assert statuses == [201, 409], (
        f"expected one created and one refused, got {statuses}: "
        f"{first.text[:200]} | {second.text[:200]}"
    )

    refused = first if first.status_code == 409 else second
    assert world["pp_reference"] in refused.json()["detail"]

    async with world["sessionmaker"]() as session:
        consignments = (
            await session.execute(
                select(Consignment).where(
                    Consignment.parcel_perfect_reference == world["pp_reference"]
                )
            )
        ).scalars().all()
        assert len(consignments) == 1, f"{len(consignments)} consignment rows for one waybill"

        trips = (
            await session.execute(
                select(Trip.id).where(Trip.operator_organization_id == world["org"].id)
            )
        ).scalars().all()
        assert len(trips) == 1, f"{len(trips)} trips survived — the loser left a trip behind"

        anchors = (
            await session.execute(
                select(BlockchainReceipt).where(
                    BlockchainReceipt.trip_id.in_(trips),
                    BlockchainReceipt.receipt_type == BlockchainReceiptType.JOURNEY_LOCK,
                )
            )
        ).scalars().all()
        assert len(anchors) == 1, (
            f"{len(anchors)} journey-lock hashes anchored for one waybill — "
            "the ledger now carries contradictory evidence"
        )


# ── The manifest race: same PP manifest, two dispatchers, same instant ────────


class _ManifestPPClient:
    def __init__(self, manifest: PPManifestResponse) -> None:
        self._manifest = manifest

    async def get_manifest(self, manifest_number: int) -> PPManifestResponse:
        return self._manifest


async def test_concurrent_creation_from_one_manifest_creates_one_trip(
    client: AsyncClient, racing_api_world: dict[str, Any], monkeypatch: MonkeyPatch
) -> None:
    """One PP manifest may back only one non-cancelled trip — under concurrency too.

    Both callers clear the preview-time check (find_live_trip_for_manifest) before
    either inserts. uq_trips_pp_manifest decides it at the trip INSERT — before any
    consignment work — so the barrier sits on that pre-check, not on a PP fetch.
    """
    world = racing_api_world
    account = world["suffix"][:6].upper()
    async with world["sessionmaker"]() as session:
        (await session.get(Organization, world["principal"].id)).pp_account_number = account
        origin = await session.get(Precinct, world["origin"].id)
        origin.pp_hub_code = "CPT"
        origin.is_shared = True
        destination = await session.get(Precinct, world["destination"].id)
        destination.pp_hub_code = "JNB"
        destination.is_shared = True
        await session.commit()

    now = datetime.now(UTC)
    waybill = _make_waybill(f"{world['pp_reference']}M1")
    waybill.details = dataclasses.replace(waybill.details, accnum=account, manifest=900)
    manifest = PPManifestResponse(
        header=PPManifestHeader(
            manifest_number=900, issuer_account=account, issuer_name="Racing Client",
            origin_hub="CPT", destination_hub="JNB", created_at=now, closed_at=now,
            planned_departure_at=now, expected_arrival_at=None, client_reference=None, notes=[],
        ),
        waybills=[waybill],
    )
    monkeypatch.setattr(consignments_manifest_import, "get_pp_client", lambda: _ManifestPPClient(manifest))

    real_find = consignments_manifest_import.find_live_trip_for_manifest
    barrier = asyncio.Barrier(_RACERS)

    async def _cleared_check_then_wait(db: AsyncSession, **kwargs: Any) -> Trip | None:
        found = await real_find(db, **kwargs)
        await barrier.wait()
        return found

    monkeypatch.setattr(consignments_manifest_import, "find_live_trip_for_manifest", _cleared_check_then_wait)

    body = {
        "manifest_number": 900,
        "expected_snapshot_sha256": compute_snapshot_sha256(manifest_snapshot(manifest)),
        "driver_id": world["payload_base"]["driver_id"],
        "horse_id": world["payload_base"]["horse_id"],
        "trailer_ids": world["payload_base"]["trailer_ids"],
    }
    headers_a, headers_b = (
        auth_header(make_token(sub=str(u.id), role="dispatcher", org_id=str(world["org"].id)))
        for u in (world["user"], world["user_b"])
    )

    first, second = await asyncio.gather(
        client.post("/api/v1/trips/from-pp-manifest", json=body, headers=headers_a),
        client.post("/api/v1/trips/from-pp-manifest", json=body, headers=headers_b),
    )

    statuses = sorted([first.status_code, second.status_code])
    assert statuses == [201, 409], f"{first.text[:200]} | {second.text[:200]}"
    winner, refused = (first, second) if first.status_code == 201 else (second, first)
    assert refused.json()["detail"]["code"] == "MANIFEST_ALREADY_ON_TRIP"
    assert refused.json()["detail"]["trip_reference"] == winner.json()["trip_reference"]
    async with world["sessionmaker"]() as session:
        trips = (await session.execute(
            select(Trip).where(Trip.operator_organization_id == world["org"].id, Trip.pp_manifest_number == 900)
        )).scalars().all()
    assert len(trips) == 1
