"""Behaviour-baseline gap tests (audit B4 and B5) that need the phase trip fixture.

Both pin behaviour that no existing test asserts, found by the Phase 1 coverage inventory:

  B4  a legacy (unversioned) confirmation receipt whose driver_visual_count was never
      captured still verifies end to end. Existing tests cover the payload SHAPE for
      that case and the recovery path, but not verify_subject.
  B5  a replayed offline phase submission never overwrites the position and capture time
      already stored on the row. Existing replay tests count rows and pin completed_at,
      but not these fields.
  B5  phase completion stays committed when the broker rejects the anchor dispatch. The
      existing broker test only asserts that the local fallback is scheduled (and patches
      it in app.orchestration.phases.anchor_dispatch); this one asserts the committed phase row, and
      patches only app.tasks.blockchain, which is not moving.

The fixture is reused from test_phase_anchor_payload (same hand-built single-leg plan).
It is assigned rather than imported by name: a fixture imported into a module that also
takes it as a parameter reads to ruff as a redefinition (F811), the hazard
tests/integration/conftest.py documents.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock

from sqlalchemy import select

from app.blockchain.anchor_service import compute_payload_hash
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, PhaseStatus, PhaseType, SubjectType, VerifyStatus
from app.db.models.phases import PhaseEvent
from app.orchestration.phase_service import (
    _BACKGROUND_ANCHOR_TASKS,
    advance_activation,
    advance_loading,
    compute_confirmation_canonical_payload_v1,
)
from app.orchestration.verification_service import verify_subject
from app.schemas.phases import ActivationCompleteRequest, LoadingCompleteRequest
from tests.unit import test_phase_anchor_payload as _fixtures

trip_fixture = _fixtures.trip_fixture

_FIRST_LAT = Decimal("-26.1000000")
_FIRST_LNG = Decimal("28.0500000")


async def test_verify_subject_preserves_unversioned_confirmation_receipt_without_visual_count(
    db_session, trip_fixture,
) -> None:
    trip, _driver, phases = trip_fixture
    confirmation = phases["confirmation"]
    confirmation.parcel_count_destination = 42
    confirmation.driver_visual_count = None
    # The key stays present as null: that is the shape the original anchor hashed.
    payload = compute_confirmation_canonical_payload_v1(
        phase_event_id=confirmation.id, trip_id=trip.id,
        pp_scan_in_count=42, driver_visual_count=None,
    )
    db_session.add(BlockchainReceipt(
        id=uuid.uuid4(), trip_id=trip.id,
        subject_type=SubjectType.PHASE_EVENT, subject_id=confirmation.id,
        receipt_type=BlockchainReceiptType.DELIVERY,
        payload_json=payload, data_hash=compute_payload_hash(payload),
        hedera_topic_id="0.0.12345", hedera_sequence_number=12,
    ))
    await db_session.flush()
    hedera = MagicMock()
    hedera.verify_hash.return_value = True

    outcome = await verify_subject(
        db_session, subject_type=SubjectType.PHASE_EVENT, subject_id=confirmation.id,
        hedera_service=hedera,
    )

    assert outcome.status == VerifyStatus.VERIFIED
    hedera.verify_hash.assert_called_once()


async def _stored_position(db_session, event_id: uuid.UUID) -> tuple[Decimal | None, Decimal | None, datetime | None]:
    db_session.expire_all()
    row = (await db_session.execute(select(PhaseEvent).where(PhaseEvent.id == event_id))).scalar_one()
    return row.driver_phone_lat, row.driver_phone_lng, row.driver_captured_at


async def test_replayed_activation_with_different_position_does_not_overwrite_the_stored_one(
    db_session, trip_fixture,
) -> None:
    trip, driver, phases = trip_fixture
    # Plain values up front: _stored_position expires the session, and reading an attribute
    # of an expired instance from async code raises MissingGreenlet.
    trip_id, driver_id, activation_id = trip.id, driver.id, phases["activation"].id
    key = str(uuid.uuid4())
    captured_at = datetime.now(UTC) - timedelta(seconds=30)
    await advance_activation(
        db_session, trip_id=trip_id, driver_id=driver_id, phase_event_id=activation_id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, idempotency_key=key,
            driver_phone_lat=float(_FIRST_LAT), driver_phone_lng=float(_FIRST_LNG),
            driver_captured_at=captured_at,
        ),
    )
    stored_before = await _stored_position(db_session, activation_id)

    await advance_activation(
        db_session, trip_id=trip_id, driver_id=driver_id, phase_event_id=activation_id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, idempotency_key=key,
            driver_phone_lat=1.5, driver_phone_lng=2.5,
            driver_captured_at=captured_at + timedelta(hours=3),
        ),
    )

    stored_after = await _stored_position(db_session, activation_id)
    assert stored_before == (_FIRST_LAT, _FIRST_LNG, captured_at)
    assert stored_after == stored_before


async def test_replayed_loading_without_a_fix_does_not_erase_the_stored_position(
    db_session, trip_fixture,
) -> None:
    # The no-fix replay is the realistic one: the original submission captured a fix, the
    # retry was built after permission was lost. None must never overwrite a stored value.
    trip, driver, phases = trip_fixture
    trip_id, driver_id = trip.id, driver.id
    activation_id, loading_id = phases["activation"].id, phases["loading"].id
    await advance_activation(
        db_session, trip_id=trip_id, driver_id=driver_id, phase_event_id=activation_id,
        payload=ActivationCompleteRequest(
            phase_type=PhaseType.ACTIVATION, idempotency_key=str(uuid.uuid4()),
            driver_phone_lat=0.0, driver_phone_lng=0.0,
        ),
    )
    key = str(uuid.uuid4())
    captured_at = datetime.now(UTC) - timedelta(seconds=30)
    await advance_loading(
        db_session, trip_id=trip_id, driver_id=driver_id, phase_event_id=loading_id,
        payload=LoadingCompleteRequest(
            phase_type=PhaseType.LOADING, idempotency_key=key,
            driver_phone_lat=float(_FIRST_LAT), driver_phone_lng=float(_FIRST_LNG),
            driver_captured_at=captured_at,
        ),
    )
    stored_before = await _stored_position(db_session, loading_id)

    await advance_loading(
        db_session, trip_id=trip_id, driver_id=driver_id, phase_event_id=loading_id,
        payload=LoadingCompleteRequest(phase_type=PhaseType.LOADING, idempotency_key=key),
    )

    stored_after = await _stored_position(db_session, loading_id)
    assert stored_before == (_FIRST_LAT, _FIRST_LNG, captured_at)
    assert stored_after == stored_before


async def test_phase_completion_stays_committed_when_the_broker_rejects_the_anchor_dispatch(
    db_session, trip_fixture, monkeypatch,
) -> None:
    trip, driver, phases = trip_fixture
    departure_id = phases["departure"].id

    class _UnreachableBroker:
        @staticmethod
        def delay(*_args: object, **_kwargs: object) -> None:
            raise ConnectionError("broker unreachable")

    # Replace the local fallback's work so it never opens a real database session; what
    # matters here is that it is reached, not that it anchors.
    fallback_calls: list[uuid.UUID] = []

    async def _record_fallback(**kwargs: object) -> bool:
        fallback_calls.append(kwargs["phase_event_id"])  # type: ignore[arg-type]
        return True

    monkeypatch.setattr("app.tasks.blockchain.anchor_phase_event_task", _UnreachableBroker)
    monkeypatch.setattr("app.tasks.blockchain._anchor", _record_fallback)

    await _fixtures._advance_to_departure(db_session, trip, driver, phases)
    await db_session.commit()
    await asyncio.gather(*tuple(_BACKGROUND_ANCHOR_TASKS))

    row = (await db_session.execute(
        select(PhaseEvent.status, PhaseEvent.anchor_status, PhaseEvent.event_hash)
        .where(PhaseEvent.id == departure_id)
    )).one()
    assert row.status == PhaseStatus.COMPLETED
    assert row.anchor_status == AnchorStatus.PENDING  # receipt still owed, not lost
    assert row.event_hash is not None  # the evidence hash was written with the phase
    assert departure_id in fallback_calls
