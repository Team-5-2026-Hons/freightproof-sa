"""What fleet anchors, verify_subject must accept — for the driver and precinct sites.

The vehicle sites have this proof in test_blockchain_verify.py. Both sides now build the payload
with the same fleet.canonical functions; these tests run the real create/update functions and
verify the events they wrote, so a divergence in either direction shows up as a mismatch.
"""

import uuid
from datetime import date
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import OrganizationType, SubjectType, VerifyStatus
from app.db.models.events import DriverEvent, PrecinctEvent
from app.db.models.organisations import Organization
from app.db.models.people import User
from app.orchestration.fleet.drivers import create_driver, update_driver
from app.orchestration.fleet.precincts import create_precinct, update_precinct
from app.orchestration.verification.service import verify_subject
from app.schemas.organisations import PrecinctCreateBody, PrecinctUpdateBody
from app.schemas.people import DriverCreateBody, DriverUpdateBody

_VALID_ID_NUMBER = "9001015009081"


async def _persisting_anchor(
    db: AsyncSession, *, subject_type, subject_id, canonical_payload, receipt_type, **_kw: Any,
) -> BlockchainReceipt:
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
        receipt_type=receipt_type, payload_json=canonical_payload,
        data_hash=compute_payload_hash(canonical_payload),
        hedera_topic_id="0.0.999999", hedera_sequence_number=1,
    )
    db.add(receipt)
    await db.flush()
    return receipt


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    org = Organization(id=uuid.uuid4(), name="Roundtrip Org", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"rt-{uuid.uuid4()}@test.co.za",
        full_name="Roundtrip User", is_active=True,
    )
    db.add(user)
    await db.flush()
    return org.id, user.id


async def _verify(db: AsyncSession, subject_type: SubjectType, event_id: uuid.UUID) -> VerifyStatus:
    hedera = MagicMock()
    hedera.verify_hash.return_value = True
    outcome = await verify_subject(
        db, subject_type=subject_type, subject_id=event_id, hedera_service=hedera,
    )
    return outcome.status


@pytest.mark.asyncio
async def test_driver_created_and_licence_renewed_events_verify(db_session: AsyncSession) -> None:
    org_id, user_id = await _seed(db_session)
    body = DriverCreateBody(
        full_name="Thabo Nkosi", id_number=_VALID_ID_NUMBER, phone_number="+27820000001",
        license_number="DRV-RT-001", license_expiry=date(2030, 1, 1),
    )

    with (
        patch(
            "app.orchestration.fleet.drivers.create_driver_auth_user",
            new=AsyncMock(return_value=uuid.uuid4()),
        ),
        patch("app.orchestration.fleet.drivers.anchor_subject", _persisting_anchor),
    ):
        created = await create_driver(db_session, org_id, body, user_id)
        await update_driver(
            db_session, created.id, org_id,
            DriverUpdateBody.model_validate({"license_number": "DRV-RT-002"}), user_id,
        )

    events = (
        await db_session.execute(select(DriverEvent).where(DriverEvent.driver_id == created.id))
    ).scalars().all()
    assert len(events) == 2
    for event in events:
        assert event.blockchain_receipt_id is not None
        assert await _verify(db_session, SubjectType.DRIVER_EVENT, event.id) == VerifyStatus.VERIFIED


@pytest.mark.asyncio
async def test_precinct_update_mixing_critical_and_cosmetic_fields_verifies(
    db_session: AsyncSession,
) -> None:
    org_id, user_id = await _seed(db_session)
    body = PrecinctCreateBody(
        name="Roundtrip Depot", address="1 Test Road", latitude=-29.7942, longitude=30.9820,
        geofence_radius_metres=200,
    )

    with patch("app.orchestration.fleet.precincts.anchor_subject", _persisting_anchor):
        created = await create_precinct(db_session, org_id, body, user_id)
        await update_precinct(
            db_session, created.id, org_id,
            PrecinctUpdateBody.model_validate({"geofence_radius_metres": 350, "name": "Renamed"}),
            user_id,
        )

    events = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalars().all()
    assert len(events) == 2
    for event in events:
        assert event.blockchain_receipt_id is not None
        assert await _verify(db_session, SubjectType.PRECINCT_EVENT, event.id) == VerifyStatus.VERIFIED
