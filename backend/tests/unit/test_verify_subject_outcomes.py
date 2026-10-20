"""Pins every VerifyOutcome field verify_subject returns, per subject type and path.

Written before verify_subject's if/elif chain became a registry (audit phase 3 D), to hold
the contract the registry must keep: which status, which receipt, and which of expected_hash /
current_hash / evidence_verified are populated for each way a subject can fail to rebuild.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, DriverEventType, IdvsStatus, OrganizationType, SubjectType, VerifyStatus,
)
from app.db.models.events import DriverEvent
from app.db.models.organisations import Organization
from app.db.models.people import Driver, User
from app.orchestration.verification.service import _hash_payload, verify_subject


def _hedera_match() -> MagicMock:
    stub = MagicMock()
    stub.verify_hash.return_value = True
    return stub


async def _receipt_for(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID,
    *, payload: dict | None = None, data_hash: str | None = None,
) -> BlockchainReceipt:
    payload = payload if payload is not None else {}
    receipt = BlockchainReceipt(
        id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
        receipt_type=BlockchainReceiptType.DRIVER_UPDATED, payload_json=payload,
        data_hash=data_hash or _hash_payload(payload),
        hedera_topic_id="0.0.999999", hedera_sequence_number=1,
    )
    db.add(receipt)
    await db.flush()
    return receipt


@pytest.mark.parametrize(
    "subject_type", [SubjectType.VEHICLE, SubjectType.DRIVER, SubjectType.AUDIT_PACK],
)
async def test_subject_types_with_no_rebuild_report_no_receipt_but_carry_the_receipt(
    db_session: AsyncSession, subject_type: SubjectType,
) -> None:
    subject_id = uuid.uuid4()
    receipt = await _receipt_for(db_session, subject_type, subject_id)

    outcome = await verify_subject(
        db_session, subject_type=subject_type, subject_id=subject_id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None
    assert outcome.evidence_verified is False


@pytest.mark.parametrize(
    "subject_type",
    [SubjectType.TRIP, SubjectType.VEHICLE_EVENT, SubjectType.DRIVER_EVENT, SubjectType.PRECINCT_EVENT],
)
async def test_a_receipt_whose_subject_row_is_gone_reports_no_receipt_with_the_receipt(
    db_session: AsyncSession, subject_type: SubjectType,
) -> None:
    subject_id = uuid.uuid4()
    receipt = await _receipt_for(db_session, subject_type, subject_id)

    outcome = await verify_subject(
        db_session, subject_type=subject_type, subject_id=subject_id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None
    assert outcome.evidence_verified is False


async def test_a_phase_event_receipt_whose_event_is_gone_is_a_db_mismatch_with_expected_hash_only(
    db_session: AsyncSession,
) -> None:
    subject_id = uuid.uuid4()
    receipt = await _receipt_for(db_session, SubjectType.PHASE_EVENT, subject_id)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=subject_id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.receipt is receipt
    assert outcome.expected_hash == receipt.data_hash
    assert outcome.current_hash is None
    assert outcome.evidence_verified is False


async def test_a_trip_receipt_of_an_unknown_payload_version_is_an_error_with_the_receipt(
    db_session: AsyncSession,
) -> None:
    subject_id = uuid.uuid4()
    receipt = await _receipt_for(
        db_session, SubjectType.TRIP, subject_id, payload={"payload_version": 99},
    )

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=subject_id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.ERROR
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None
    assert outcome.evidence_verified is False


async def test_a_phase_event_receipt_of_an_unknown_payload_version_is_an_error_with_the_receipt(
    db_session: AsyncSession,
) -> None:
    from app.orchestration.verification.errors import _UnsupportedPhasePayloadVersion

    subject_id = uuid.uuid4()
    receipt = await _receipt_for(db_session, SubjectType.PHASE_EVENT, subject_id)

    with patch(
        "app.orchestration.verification.service.reconstruct_phase_state",
        new=AsyncMock(side_effect=_UnsupportedPhasePayloadVersion("v99")),
    ):
        outcome = await verify_subject(
            db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=subject_id,
            hedera_service=_hedera_match(),
        )

    assert outcome.status == VerifyStatus.ERROR
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None


async def _driver_event_with_receipt(
    db: AsyncSession,
) -> tuple[DriverEvent, BlockchainReceipt]:
    org = Organization(id=uuid.uuid4(), name="Outcome Org", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()
    user = User(
        id=uuid.uuid4(), organization_id=org.id, email=f"o-{uuid.uuid4()}@test.co.za",
        full_name="Outcome User", is_active=True,
    )
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Outcome Driver",
        id_number="9001015009081", phone_number="+27820000009", license_number="DRV-OUT-1",
        idvs_status=IdvsStatus.PENDING,
    )
    db.add_all([user, driver])
    await db.flush()
    event = DriverEvent(
        id=uuid.uuid4(), driver_id=driver.id, event_type=DriverEventType.LICENSE_RENEWED.value,
        changed_fields={"license_number_sha256": {"from": "a" * 64, "to": "b" * 64}},
        changed_by_user_id=user.id,
    )
    db.add(event)
    await db.flush()
    payload = {
        "driver_event_id": str(event.id), "driver_id": str(driver.id),
        "event_type": event.event_type, "fields": event.changed_fields,
        "changed_by_user_id": str(user.id), "timestamp": event.created_at.isoformat(),
    }
    receipt = await _receipt_for(db, SubjectType.DRIVER_EVENT, event.id, payload=payload)
    return event, receipt


async def test_a_driver_event_matching_its_receipt_and_hedera_is_verified_without_evidence(
    db_session: AsyncSession,
) -> None:
    event, receipt = await _driver_event_with_receipt(db_session)

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.DRIVER_EVENT, subject_id=event.id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.VERIFIED
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None
    assert outcome.evidence_verified is False


async def test_a_tampered_driver_event_is_a_db_mismatch_with_both_hashes(
    db_session: AsyncSession,
) -> None:
    event, receipt = await _driver_event_with_receipt(db_session)
    row = (
        await db_session.execute(select(DriverEvent).where(DriverEvent.id == event.id))
    ).scalar_one()
    row.changed_fields = {"license_number_sha256": {"from": "a" * 64, "to": "c" * 64}}
    await db_session.flush()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.DRIVER_EVENT, subject_id=event.id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.receipt is receipt
    assert outcome.expected_hash == receipt.data_hash
    assert outcome.current_hash is not None
    assert outcome.current_hash != receipt.data_hash
    assert outcome.evidence_verified is False


async def test_a_receipt_without_a_topic_is_an_error_after_the_hashes_match(
    db_session: AsyncSession,
) -> None:
    event, receipt = await _driver_event_with_receipt(db_session)
    receipt.hedera_topic_id = None
    await db_session.flush()

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.DRIVER_EVENT, subject_id=event.id,
        hedera_service=_hedera_match(),
    )

    assert outcome.status == VerifyStatus.ERROR
    assert outcome.receipt is receipt
    assert outcome.expected_hash is None
    assert outcome.current_hash is None


async def test_a_hedera_hash_that_disagrees_is_a_hedera_mismatch_with_expected_hash(
    db_session: AsyncSession,
) -> None:
    event, receipt = await _driver_event_with_receipt(db_session)
    stub = MagicMock()
    stub.verify_hash.return_value = False

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.DRIVER_EVENT, subject_id=event.id,
        hedera_service=stub,
    )

    assert outcome.status == VerifyStatus.HEDERA_MISMATCH
    assert outcome.receipt is receipt
    assert outcome.expected_hash == receipt.data_hash
    assert outcome.current_hash is None
