"""Pins the exact payload (and so the Hedera hash) fleet.drivers and fleet.precincts anchor.

Extends tests/integration/test_vehicle_anchor_payload_pins.py to the other four of the six
anchor sites (driver create/update, precinct create/update). Same rules: golden vectors, the
real create/update functions run against the test DB, and only the parts the DB or the clock
generates (event id, entity id, actor, timestamp) are replaced with constants before hashing.
A change here means receipts already anchored stop verifying; never "update the expected value".
"""

import uuid
from datetime import date
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import IdvsStatus, OrganizationType
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.orchestration.fleet.drivers import create_driver, update_driver
from app.orchestration.fleet.precincts import create_precinct, update_precinct
from app.schemas.organisations import PrecinctCreateBody, PrecinctUpdateBody
from app.schemas.people import DriverCreateBody, DriverUpdateBody

EVENT_ID = "11111111-1111-4111-8111-111111111111"
USER_ID = "33333333-3333-4333-8333-333333333333"
ENTITY_ID = "22222222-2222-4222-8222-222222222222"
TIMESTAMP = "2026-01-01T00:00:00+00:00"

DRIVER_CREATE_HASH = "295e56f28b125a84f6d28573086ace29622ecb87cb20e92eb7d9fa0863453c4d"
DRIVER_UPDATE_HASH = "0068f9e64b27b0bbbfe9133451a5259642db70c89b516931b7ffa4daa53cb1e2"
PRECINCT_CREATE_HASH = "0f17f55586caa5f779d59ecaa90a95321a831b4649fe99228ec53954c9ea1100"
PRECINCT_UPDATE_HASH = "44177d444765d3d0d59d48486626bb645b042d4aa7543deeaa435f5af4d12973"

_VALID_ID_NUMBER = "9001015009081"


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    org = Organization(id=uuid.uuid4(), name="Pin Operator", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"pin-{uuid.uuid4()}@test.co.za",
        full_name="Pin User", is_active=True,
    )
    db.add(user)
    await db.flush()
    return org.id, user.id


def _capturing_anchor(captured: list[dict[str, Any]]):
    async def _anchor(db, *, subject_type, subject_id, canonical_payload, receipt_type, **_kw):
        captured.append(dict(canonical_payload))
        receipt = BlockchainReceipt(
            id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
            receipt_type=receipt_type, payload_json=canonical_payload,
            data_hash=compute_payload_hash(canonical_payload),
            hedera_topic_id="0.0.999999", hedera_sequence_number=1,
        )
        db.add(receipt)
        await db.flush()
        return receipt
    return _anchor


def _pinned(payload: dict[str, Any], *, entity_key: str, event_key: str) -> dict[str, Any]:
    return {
        **payload, event_key: EVENT_ID, entity_key: ENTITY_ID,
        "changed_by_user_id": USER_ID, "timestamp": TIMESTAMP,
    }


def _driver_pinned(payload: dict[str, Any]) -> dict[str, Any]:
    return _pinned(payload, entity_key="driver_id", event_key="driver_event_id")


def _precinct_pinned(payload: dict[str, Any]) -> dict[str, Any]:
    return _pinned(payload, entity_key="precinct_id", event_key="precinct_event_id")


async def _seed_driver(db: AsyncSession, org_id: uuid.UUID) -> Driver:
    driver = Driver(
        id=uuid.uuid4(), organization_id=org_id, full_name="Pin Driver",
        id_number=_VALID_ID_NUMBER, phone_number="+27820000001",
        license_number="DRV-PIN-OLD", license_expiry=date(2030, 1, 1),
        idvs_status=IdvsStatus.PENDING,
    )
    db.add(driver)
    await db.flush()
    return driver


def _precinct_body() -> PrecinctCreateBody:
    return PrecinctCreateBody(
        name="Pin Depot", address="12 Pin Road, Durban",
        latitude=-29.7942, longitude=30.9820, geofence_radius_metres=200,
    )


@pytest.mark.asyncio
async def test_create_driver_anchor_payload_hash_is_pinned(db_session: AsyncSession) -> None:
    org_id, user_id = await _seed(db_session)
    captured: list[dict[str, Any]] = []
    body = DriverCreateBody(
        full_name="Thabo Nkosi", id_number=_VALID_ID_NUMBER, phone_number="+27820000001",
        license_number="DRV-PIN-001", license_expiry=date(2030, 1, 1),
    )

    with (
        patch(
            "app.orchestration.fleet.drivers.create_driver_auth_user",
            new=AsyncMock(return_value=uuid.uuid4()),
        ),
        patch("app.orchestration.fleet.drivers.anchor_subject", _capturing_anchor(captured)),
    ):
        await create_driver(db_session, org_id, body, user_id)

    payload = _driver_pinned(captured[0])
    assert compute_payload_hash(payload) == DRIVER_CREATE_HASH


@pytest.mark.asyncio
async def test_update_driver_anchor_payload_hash_is_pinned(db_session: AsyncSession) -> None:
    org_id, user_id = await _seed(db_session)
    driver = await _seed_driver(db_session, org_id)
    captured: list[dict[str, Any]] = []

    with patch("app.orchestration.fleet.drivers.anchor_subject", _capturing_anchor(captured)):
        await update_driver(
            db_session, driver.id, org_id,
            DriverUpdateBody.model_validate({"license_number": "DRV-PIN-NEW"}), user_id,
        )

    payload = _driver_pinned(captured[0])
    assert compute_payload_hash(payload) == DRIVER_UPDATE_HASH


@pytest.mark.asyncio
async def test_create_precinct_anchor_payload_hash_is_pinned(db_session: AsyncSession) -> None:
    org_id, user_id = await _seed(db_session)
    captured: list[dict[str, Any]] = []

    with patch("app.orchestration.fleet.precincts.anchor_subject", _capturing_anchor(captured)):
        await create_precinct(db_session, org_id, _precinct_body(), user_id)

    payload = _precinct_pinned(captured[0])
    assert compute_payload_hash(payload) == PRECINCT_CREATE_HASH


@pytest.mark.asyncio
async def test_update_precinct_critical_plus_cosmetic_anchor_payload_hash_is_pinned(
    db_session: AsyncSession,
) -> None:
    """Unlike a vehicle, a precinct anchors the FULL diff, cosmetic name change included."""
    org_id, user_id = await _seed(db_session)
    with patch(
        "app.orchestration.fleet.precincts.anchor_subject", _capturing_anchor([]),
    ):
        created = await create_precinct(db_session, org_id, _precinct_body(), user_id)
    captured: list[dict[str, Any]] = []

    with patch("app.orchestration.fleet.precincts.anchor_subject", _capturing_anchor(captured)):
        await update_precinct(
            db_session, created.id, org_id,
            PrecinctUpdateBody.model_validate({"geofence_radius_metres": 350, "name": "Pin Depot 2"}),
            user_id,
        )

    payload = _precinct_pinned(captured[0])
    assert compute_payload_hash(payload) == PRECINCT_UPDATE_HASH
