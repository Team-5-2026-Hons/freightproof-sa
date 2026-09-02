import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, OrganizationType, PrecinctEventType, SubjectType, VerifyStatus,
)
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User
from app.orchestration.precinct_service import create_precinct
from app.orchestration.verification_service import _hash_payload, verify_subject
from app.schemas.organisations import PrecinctCreateBody


@pytest.mark.asyncio
async def test_verify_returns_no_receipt_when_none_exists(db_session):
    out = await verify_subject(
        db_session, subject_type=SubjectType.TRIP, subject_id=uuid.uuid4()
    )
    assert out.status == VerifyStatus.NO_RECEIPT


# ── Precinct event verification ────────────────────────────────────────────────
#
# NOTE for future maintainers: this file previously had no vehicle/driver-event
# verification tests to mirror, despite the plan text describing "the fixtures
# and Hedera stubbing the file already uses for test_verify_vehicle_event_*".
# No such tests or helpers (_stub_hedera_matching, _seed_unanchored_vehicle_event,
# etc.) exist anywhere in this test suite as of this task. The helpers below are
# written fresh, following the seeding pattern already established in
# tests/unit/test_precinct_service.py (Organization/User/Precinct rows via
# db_session, anchor_subject mocked out where the real service is exercised).


async def _seed_org_and_user(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """A minimal owning org and an actor user, for tests that call create_precinct directly."""
    org = Organization(id=uuid.uuid4(), name="Verify Org", org_type=OrganizationType.OPERATOR)
    db.add(org)
    await db.flush()

    user = User(
        id=uuid.uuid4(), organization_id=org.id,
        email=f"verify-{uuid.uuid4()}@test.co.za", full_name="Verifier", is_active=True,
    )
    db.add(user)
    await db.flush()
    return org.id, user.id


async def _seed_org_user_precinct(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """A precinct row plus the user who will be recorded as its event actor.

    Returns (precinct_id, user_id). Used by tests that build a PrecinctEvent row
    directly rather than going through create_precinct/update_precinct.
    """
    org_id, user_id = await _seed_org_and_user(db)
    precinct = Precinct(
        id=uuid.uuid4(), name="Verify Precinct", address="1 Test Road, Durban",
        principal_organization_id=org_id,
        latitude="-29.7942000", longitude="30.9820000",
        geofence_radius_metres=200, is_shared=False,
    )
    db.add(precinct)
    await db.flush()
    return precinct.id, user_id


async def _seed_unanchored_precinct_event(db: AsyncSession) -> uuid.UUID:
    """A PrecinctEvent row with no blockchain_receipt_id — a logged-but-unanchored
    change, e.g. a cosmetic rename (PRECINCT_COSMETIC_FIELDS never anchors)."""
    precinct_id, user_id = await _seed_org_user_precinct(db)
    event = PrecinctEvent(
        id=uuid.uuid4(),
        precinct_id=precinct_id,
        event_type=PrecinctEventType.COSMETIC_UPDATE.value,
        changed_fields={"name": {"from": "Old Name", "to": "Verify Precinct"}},
        changed_by_user_id=user_id,
    )
    db.add(event)
    await db.flush()
    return event.id


async def _seed_anchored_precinct_event(db: AsyncSession) -> uuid.UUID:
    """A precinct event plus a receipt whose data_hash matches the live row.

    The payload must be byte-identical in shape to the one precinct_service builds, or
    this test verifies a hash that production never produces. See
    test_reconstruction_matches_the_real_create_precinct_payload below for the
    stronger, end-to-end version of that proof — this helper reproduces the same
    dict shape as _reconstruct_precinct_event_payload by hand for the unit-level
    VERIFIED/DB_MISMATCH tests.
    """
    event_id = await _seed_unanchored_precinct_event(db)
    event = (
        await db.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one()

    payload = {
        "precinct_event_id": str(event.id),
        "precinct_id": str(event.precinct_id),
        "event_type": event.event_type,
        "fields": event.changed_fields,
        "changed_by_user_id": str(event.changed_by_user_id),
        "timestamp": event.created_at.isoformat(),
    }
    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event.id,
        receipt_type=BlockchainReceiptType.PRECINCT_UPDATED,
        payload_json=payload,
        data_hash=_hash_payload(payload),
        # hedera_topic_id/hedera_sequence_number are required (non-null, >=1) for
        # verify_subject to reach the Hedera-match branch at all — without them it
        # short-circuits to ERROR before ever comparing hashes.
        hedera_topic_id="0.0.999999",
        hedera_sequence_number=1,
    )
    db.add(receipt)
    await db.flush()
    event.blockchain_receipt_id = receipt.id
    await db.flush()
    return event.id


def _stub_hedera_matching(db_session: AsyncSession) -> MagicMock:
    """A HederaService double whose verify_hash always reports a match.

    Takes db_session for symmetry with the other seed helpers / in case a future
    caller wants to look up the receipt it's stubbing for; the stub itself does not
    need to inspect the DB because it always returns True — the DB_MISMATCH and
    NO_RECEIPT tests never reach the Hedera call at all (they return earlier).
    """
    del db_session  # unused — see docstring
    stub = MagicMock()
    stub.verify_hash.return_value = True
    return stub


async def test_verify_precinct_event_returns_verified_when_row_is_unchanged(
    db_session: AsyncSession,
):
    """The anchored payload and the live row still agree."""
    event_id = await _seed_anchored_precinct_event(db_session)

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        hedera_service=_stub_hedera_matching(db_session),
    )

    assert outcome.status == VerifyStatus.VERIFIED


async def test_verify_precinct_event_detects_a_tampered_event_row(db_session: AsyncSession):
    """Rewriting the logged diff after anchoring must surface as DB_MISMATCH, not as
    a clean verify. This is the whole point of anchoring a precinct at all."""
    event_id = await _seed_anchored_precinct_event(db_session)

    event = (
        await db_session.execute(select(PrecinctEvent).where(PrecinctEvent.id == event_id))
    ).scalar_one()
    event.changed_fields = {"geofence_radius_metres": {"from": 200, "to": 99999}}
    await db_session.flush()

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        hedera_service=_stub_hedera_matching(db_session),
    )

    assert outcome.status == VerifyStatus.DB_MISMATCH
    assert outcome.current_hash != outcome.expected_hash


async def test_verify_precinct_event_with_no_receipt_reports_no_receipt(
    db_session: AsyncSession,
):
    """A cosmetic rename is logged unanchored — verifying it is not an error."""
    event_id = await _seed_unanchored_precinct_event(db_session)

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
    )

    assert outcome.status == VerifyStatus.NO_RECEIPT


async def test_reconstruction_matches_the_real_create_precinct_payload(
    db_session: AsyncSession,
):
    """Byte-identical proof, end to end: run the REAL create_precinct (not a hand-copied
    dict), capture the exact canonical_payload it hands to anchor_subject, persist a
    receipt hashed from that real payload, and confirm verify_subject's independently
    reconstructed payload hashes to the same value.

    If _reconstruct_precinct_event_payload's key names/order or value types (float()
    on Decimal lat/long, str() on UUIDs, .isoformat() on the timestamp) ever drift from
    what create_precinct actually anchors, this test — not a hand-mirrored fixture —
    is what catches it.
    """
    org_id, user_id = await _seed_org_and_user(db_session)

    async def _persist_real_receipt(
        db, *, subject_type, subject_id, canonical_payload, receipt_type, **_kwargs
    ):
        receipt = BlockchainReceipt(
            id=uuid.uuid4(),
            subject_type=subject_type,
            subject_id=subject_id,
            receipt_type=receipt_type,
            payload_json=canonical_payload,
            data_hash=_hash_payload(canonical_payload),
            hedera_topic_id="0.0.999999",
            hedera_sequence_number=1,
        )
        db.add(receipt)
        await db.flush()
        return receipt

    with patch(
        "app.orchestration.precinct_service.anchor_subject", new=_persist_real_receipt,
    ):
        created = await create_precinct(
            db=db_session,
            organization_id=org_id,
            data=PrecinctCreateBody(
                name="Riverhorse Valley",
                address="12 Sookhai Place, Durban",
                latitude=-29.7942,
                longitude=30.9820,
                geofence_radius_metres=200,
            ),
            current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalar_one()

    outcome = await verify_subject(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event.id,
        hedera_service=_stub_hedera_matching(db_session),
    )

    assert outcome.status == VerifyStatus.VERIFIED
