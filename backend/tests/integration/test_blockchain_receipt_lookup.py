"""Endpoint integration coverage for blockchain receipt reverse lookup."""

import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import lookup_receipts
from app.db.models.audit_packs import AuditPack
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType,
    OrganizationType,
    PhaseType,
    SubjectType,
    VehicleType,
)
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app
from app.schemas.blockchain import BlockchainReceiptRead

from tests.conftest import auth_header, make_token

_HASH = "ab" * 32
_OTHER_HASH = "cd" * 32
_TX_ID = "transaction id with unrestricted syntax !@#$%"


@dataclass(frozen=True)
class _LookupSeed:
    organization: Organization
    other_organization: Organization
    user: User
    vehicle: Vehicle
    second_vehicle: Vehicle
    other_vehicle: Vehicle


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(
    db_session: AsyncSession,
) -> AsyncGenerator[None, None]:
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def lookup_seed(db_session: AsyncSession) -> _LookupSeed:
    organization = Organization(
        id=uuid.uuid4(),
        name="Lookup Operator",
        org_type=OrganizationType.OPERATOR,
    )
    other_organization = Organization(
        id=uuid.uuid4(),
        name="Other Lookup Operator",
        org_type=OrganizationType.OPERATOR,
    )
    db_session.add_all([organization, other_organization])
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        organization_id=organization.id,
        email="receipt-lookup@test.co.za",
        full_name="Receipt Lookup Admin",
    )
    vehicle = Vehicle(
        id=uuid.uuid4(),
        organization_id=organization.id,
        registration="LOOKUP-1",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="LOOKUP-DEVICE-1",
    )
    second_vehicle = Vehicle(
        id=uuid.uuid4(),
        organization_id=organization.id,
        registration="LOOKUP-2",
        vehicle_type=VehicleType.TRAILER,
        pulsit_device_id="LOOKUP-DEVICE-2",
    )
    other_vehicle = Vehicle(
        id=uuid.uuid4(),
        organization_id=other_organization.id,
        registration="LOOKUP-OTHER",
        vehicle_type=VehicleType.HORSE,
        pulsit_device_id="LOOKUP-DEVICE-OTHER",
    )
    db_session.add_all([user, vehicle, second_vehicle, other_vehicle])
    await db_session.flush()

    return _LookupSeed(
        organization=organization,
        other_organization=other_organization,
        user=user,
        vehicle=vehicle,
        second_vehicle=second_vehicle,
        other_vehicle=other_vehicle,
    )


def _headers(seed: _LookupSeed, *, role: str = "admin_dispatcher") -> dict[str, str]:
    return auth_header(
        make_token(
            sub=str(seed.user.id),
            role=role,
            org_id=str(seed.organization.id),
        )
    )


def _receipt(
    *,
    subject_id: uuid.UUID,
    subject_type: SubjectType = SubjectType.VEHICLE,
    receipt_type: BlockchainReceiptType = BlockchainReceiptType.VEHICLE_UPDATED,
    data_hash: str = _HASH,
    hedera_tx_id: str | None = None,
    created_at: datetime | None = None,
) -> BlockchainReceipt:
    return BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=subject_type,
        subject_id=subject_id,
        receipt_type=receipt_type,
        data_hash=data_hash,
        hedera_tx_id=hedera_tx_id,
        payload_json={"private_audit_payload": "must not be returned"},
        created_at=created_at or datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_hash_lookup_normalizes_and_returns_newest_first_without_payload(
    client: AsyncClient,
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
) -> None:
    now = datetime.now(UTC)
    older = _receipt(
        subject_id=lookup_seed.vehicle.id,
        created_at=now - timedelta(minutes=1),
    )
    newer = _receipt(
        subject_id=lookup_seed.second_vehicle.id,
        created_at=now,
    )
    db_session.add_all([older, newer])
    await db_session.flush()

    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"data_hash": f"  {_HASH.upper()}  "},
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body] == [str(newer.id), str(older.id)]
    assert all(item["data_hash"] == _HASH for item in body)
    assert all("payload_json" not in item for item in body)


@pytest.mark.asyncio
async def test_tx_lookup_trims_then_matches_exactly(
    client: AsyncClient,
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
) -> None:
    receipt = _receipt(
        subject_id=lookup_seed.vehicle.id,
        data_hash=_OTHER_HASH,
        hedera_tx_id=_TX_ID,
    )
    db_session.add(receipt)
    await db_session.flush()

    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"hedera_tx_id": f"  {_TX_ID}  "},
        headers=_headers(lookup_seed),
    )
    wrong_case_response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"hedera_tx_id": _TX_ID.upper()},
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [str(receipt.id)]
    assert wrong_case_response.status_code == 200
    assert wrong_case_response.json() == []


@pytest.mark.asyncio
async def test_lookup_applies_optional_subject_filter(
    client: AsyncClient,
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
) -> None:
    matching = _receipt(subject_id=lookup_seed.vehicle.id)
    other_subject = _receipt(subject_id=lookup_seed.second_vehicle.id)
    db_session.add_all([matching, other_subject])
    await db_session.flush()

    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"data_hash": _HASH, "subject_id": str(lookup_seed.vehicle.id)},
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [str(matching.id)]


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"data_hash": _HASH, "hedera_tx_id": _TX_ID},
        {"data_hash": "malformed"},
    ],
)
@pytest.mark.asyncio
async def test_lookup_rejects_invalid_query_combinations(
    client: AsyncClient,
    lookup_seed: _LookupSeed,
    params: dict[str, str],
) -> None:
    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params=params,
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_lookup_returns_empty_list_when_nothing_matches(
    client: AsyncClient,
    lookup_seed: _LookupSeed,
) -> None:
    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"data_hash": _OTHER_HASH},
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_lookup_hides_matches_owned_by_another_organization(
    client: AsyncClient,
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
) -> None:
    hidden = _receipt(subject_id=lookup_seed.other_vehicle.id)
    db_session.add(hidden)
    await db_session.flush()

    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"data_hash": _HASH},
        headers=_headers(lookup_seed),
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_lookup_rejects_non_admin_dispatcher(
    client: AsyncClient,
    lookup_seed: _LookupSeed,
) -> None:
    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={"data_hash": _HASH},
        headers=_headers(lookup_seed, role="dispatcher"),
    )

    assert response.status_code == 403


@pytest.mark.parametrize("receipt_count", [1, 25])
async def test_lookup_uses_one_query_without_loading_audit_payloads(
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
    receipt_count: int,
) -> None:
    organization_id = lookup_seed.organization.id
    db_session.add_all(
        [_receipt(subject_id=lookup_seed.vehicle.id) for _ in range(receipt_count)]
    )
    await db_session.flush()
    db_session.expunge_all()

    with (
        patch.object(db_session, "execute", wraps=db_session.execute) as execute,
        patch("app.blockchain.anchor_service.HederaService") as hedera,
    ):
        receipts = await lookup_receipts(
            db_session,
            organization_id=organization_id,
            data_hash=_HASH,
        )
        response = [BlockchainReceiptRead.model_validate(r) for r in receipts]

    assert len(response) == receipt_count
    assert execute.await_count == 1
    assert all("payload_json" in inspect(r).unloaded for r in receipts)
    hedera.assert_not_called()


@pytest.mark.parametrize("lookup_key", ["data_hash", "hedera_tx_id"])
async def test_lookup_is_tenant_safe_for_every_subject_type_and_direction(
    client: AsyncClient,
    db_session: AsyncSession,
    lookup_seed: _LookupSeed,
    lookup_key: str,
) -> None:
    now = datetime.now(UTC)
    expected_ids: list[uuid.UUID] = []
    for organization, vehicle in [
        (lookup_seed.organization, lookup_seed.vehicle),
        (lookup_seed.other_organization, lookup_seed.other_vehicle),
    ]:
        driver = Driver(
            id=uuid.uuid4(),
            organization_id=organization.id,
            full_name="Driver",
            id_number="8001015009087",
            phone_number="+27821234567",
            license_number="TEST",
        )
        precinct = Precinct(
            id=uuid.uuid4(),
            principal_organization_id=organization.id,
            name="Shared Depot",
            latitude="0",
            longitude="0",
            is_shared=True,
        )
        db_session.add_all([driver, precinct])
        await db_session.flush()
        trip = Trip(
            id=uuid.uuid4(),
            trip_reference=uuid.uuid4().hex,
            order_number=uuid.uuid4().hex,
            operator_organization_id=organization.id,
            # Being the client or the event author must not grant operator access.
            client_organization_id=lookup_seed.organization.id,
            driver_id=driver.id,
            horse_id=vehicle.id,
            created_by_user_id=lookup_seed.user.id,
        )
        db_session.add(trip)
        await db_session.flush()
        stop = TripStop(
            id=uuid.uuid4(), trip_id=trip.id, precinct_id=precinct.id, sequence=1
        )
        db_session.add(stop)
        await db_session.flush()
        phase = PhaseEvent(
            id=uuid.uuid4(),
            trip_id=trip.id,
            trip_stop_id=stop.id,
            phase_type=PhaseType.DEPARTURE,
            sequence_number=3,
        )
        vehicle_event = VehicleEvent(
            id=uuid.uuid4(),
            vehicle_id=vehicle.id,
            event_type="created",
            changed_fields={},
            changed_by_user_id=lookup_seed.user.id,
        )
        driver_event = DriverEvent(
            id=uuid.uuid4(),
            driver_id=driver.id,
            event_type="created",
            changed_fields={},
            changed_by_user_id=lookup_seed.user.id,
        )
        precinct_event = PrecinctEvent(
            id=uuid.uuid4(),
            precinct_id=precinct.id,
            event_type="created",
            changed_fields={},
            changed_by_user_id=lookup_seed.user.id,
        )
        audit_pack = AuditPack(
            id=uuid.uuid4(), trip_id=trip.id, organization_id=organization.id, pack_version=1,
            purpose="insurance_claim", recipient_name="R", recipient_organization="R",
            include_location_trail=False, include_full_driver_id=False, manifest_version=1,
            manifest_json={}, manifest_sha256="0" * 64, pdf_storage_bucket="b", pdf_storage_key="k",
            pdf_sha256="0" * 64, pdf_size_bytes=1, anchor_status="anchored", token_hash=uuid.uuid4().hex * 2,
            issued_at=now, expires_at=now, issued_by_user_id=lookup_seed.user.id,
        )
        db_session.add_all([phase, vehicle_event, driver_event, precinct_event, audit_pack])
        await db_session.flush()

        subjects = [
            (SubjectType.TRIP, trip.id, BlockchainReceiptType.JOURNEY_LOCK),
            (SubjectType.VEHICLE, vehicle.id, BlockchainReceiptType.VEHICLE_CREATED),
            (SubjectType.DRIVER, driver.id, BlockchainReceiptType.DRIVER_CREATED),
            (
                SubjectType.VEHICLE_EVENT,
                vehicle_event.id,
                BlockchainReceiptType.VEHICLE_CREATED,
            ),
            (
                SubjectType.DRIVER_EVENT,
                driver_event.id,
                BlockchainReceiptType.DRIVER_CREATED,
            ),
            (
                SubjectType.PRECINCT_EVENT,
                precinct_event.id,
                BlockchainReceiptType.PRECINCT_CREATED,
            ),
            (SubjectType.PHASE_EVENT, phase.id, BlockchainReceiptType.PICKUP),
            (SubjectType.AUDIT_PACK, audit_pack.id, BlockchainReceiptType.AUDIT_PACK_ISSUED),
        ]
        for subject_type, subject_id, receipt_type in subjects:
            receipt = _receipt(
                subject_type=subject_type,
                subject_id=subject_id,
                receipt_type=receipt_type,
                hedera_tx_id=_TX_ID,
                created_at=now,
            )
            db_session.add(receipt)
            if organization.id == lookup_seed.organization.id:
                expected_ids.append(receipt.id)

    db_session.add_all(
        [
            _receipt(
                subject_type=subject_type, subject_id=uuid.uuid4(), hedera_tx_id=_TX_ID
            )
            for subject_type in SubjectType
        ]
    )
    db_session.add_all(
        [
            _receipt(
                subject_type=cast(SubjectType, "unsupported_subject"),
                subject_id=lookup_seed.vehicle.id,
                hedera_tx_id=_TX_ID,
            ),
            _receipt(
                subject_type=SubjectType.PHASE_EVENT,
                subject_id=lookup_seed.second_vehicle.id,
                hedera_tx_id=_TX_ID,
            ),
        ]
    )
    await db_session.flush()
    params = {lookup_key: _HASH if lookup_key == "data_hash" else _TX_ID}
    headers = _headers(lookup_seed)

    response = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params=params,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body] == [
        str(i) for i in sorted(expected_ids, reverse=True)
    ]
    assert {item["subject_type"] for item in body} == {s.value for s in SubjectType}
    assert all("payload_json" not in item for item in body)
    for item in body:
        filtered = await client.get(
            "/api/v1/blockchain/receipts/lookup",
            params={**params, "subject_id": item["subject_id"]},
            headers=headers,
        )
        forward = await client.get(
            "/api/v1/blockchain/receipts",
            params={
                "subject_type": item["subject_type"],
                "subject_id": item["subject_id"],
            },
            headers=headers,
        )
        assert filtered.status_code == forward.status_code == 200
        assert filtered.json() == forward.json() == [item]

    hidden = await client.get(
        "/api/v1/blockchain/receipts/lookup",
        params={**params, "subject_id": str(lookup_seed.other_vehicle.id)},
        headers=headers,
    )
    assert hidden.status_code == 200
    assert hidden.json() == []
