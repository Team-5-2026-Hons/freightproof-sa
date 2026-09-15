"""The verification lifecycle against a real database, with the mock vendor.

The ordering assertion matters most: a verification row exists BEFORE any confirmation
row does, which is the whole reason Task 1 re-keyed it onto the token."""

import hashlib
import uuid
from datetime import UTC, datetime

import pytest_asyncio

from app.core.config import settings
from app.db.models.enums import (
    AnchorStatus,
    ArtifactType,
    IdvsStatus,
    PhaseStatus,
    PhaseType,
    ReceiverVerificationStatus,
    ReceiverVerificationUnverifiedReason,
    TripStatus,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip, TripStop
from app.integrations.idvs import IdvsDecisionStatus, MockIdvsClient
from app.orchestration.handover_service import issue_capability_token, record_handover_confirmation
from app.orchestration.receiver_verification_service import (
    attach_confirmation,
    record_consent,
    resolve_verification,
    start_verification,
)

_CONSENT = "I agree to my identity document and photograph being checked."


@pytest_asyncio.fixture
async def seeded_phase_event(db_session, seed):
    """A CONFIRMATION phase event on an active trip at its destination stop.

    Copied from tests/integration/test_handover_endpoints.py's `handover_trip` fixture —
    there is no shared fixture for this in conftest.py, and each handover test file
    builds its own. If that file's version has drifted, follow it rather than this copy.
    """
    trip = Trip(
        id=uuid.uuid4(),
        trip_reference=f"FP-{uuid.uuid4().hex[:6].upper()}",
        order_number="ORD-VERIFY",
        operator_organization_id=seed["org"].id,
        driver_id=seed["driver"].id,
        horse_id=seed["horse"].id,
        status=TripStatus.ACTIVE,
        idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=seed["dispatcher"].id,
    )
    db_session.add(trip)
    await db_session.flush()

    stop = TripStop(id=uuid.uuid4(), trip_id=trip.id, precinct_id=seed["dest"].id, sequence=1)
    db_session.add(stop)
    await db_session.flush()

    event = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, trip_stop_id=stop.id,
        phase_type=PhaseType.CONFIRMATION, sequence_number=6,
        status=PhaseStatus.PENDING, anchor_status=AnchorStatus.PENDING,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _fresh_token(db_session, seeded_phase_event):
    return await issue_capability_token(
        db_session,
        phase_event_id=seeded_phase_event.id,
        trip_id=seeded_phase_event.trip_id,
        trip_stop_id=seeded_phase_event.trip_stop_id,
    )


async def test_consent_creates_a_pending_row_keyed_on_the_token(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)

    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    assert v.token_id == token.id
    assert v.handover_confirmation_id is None, "no confirmation exists yet — this is the point"
    assert v.status is ReceiverVerificationStatus.PENDING


async def test_consent_records_the_hash_of_the_wording_not_the_wording(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)

    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    assert v.consent_text_hash == hashlib.sha256(_CONSENT.encode("utf-8")).hexdigest()
    assert v.consent_given_at is not None


async def test_start_verification_returns_a_session_and_stores_its_id(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    session = await start_verification(
        db_session, token=token, verification=v, client=MockIdvsClient(),
    )

    assert session is not None
    assert v.provider_session_id == session.session_id


async def test_quota_exhaustion_degrades_without_calling_the_vendor(
    db_session, seeded_phase_event, monkeypatch,
):
    monkeypatch.setattr(settings, "IDVS_MONTHLY_SESSION_LIMIT", 0)
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)

    session = await start_verification(
        db_session, token=token, verification=v, client=MockIdvsClient(),
    )

    assert session is None
    assert v.status is ReceiverVerificationStatus.UNVERIFIED
    assert v.unverified_reason is ReceiverVerificationUnverifiedReason.QUOTA_EXHAUSTED
    assert v.provider_session_id is None, "no session may be created once the quota is spent"


async def test_resolve_fetches_the_decision_for_our_stored_session_id(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.VERIFIED
    assert v.provider_decision_at is not None


async def test_a_declined_session_is_failed_not_unverified(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)
    await client.stage_decision(v.provider_session_id, status=IdvsDecisionStatus.DECLINED)

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.FAILED


async def test_extracted_identity_disagreeing_with_typed_identity_fails(db_session, seeded_phase_event):
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    client = MockIdvsClient()
    await start_verification(db_session, token=token, verification=v, client=client)
    await client.stage_decision(
        v.provider_session_id,
        status=IdvsDecisionStatus.APPROVED,
        extracted_surname="Dlamini",
        extracted_id_number="8801015800085",
    )

    await resolve_verification(
        db_session, verification=v, client=client,
        typed_name="Thandi Nkosi", typed_id_number="9202204720082",
    )

    assert v.status is ReceiverVerificationStatus.FAILED
    assert v.identity_match is False


async def test_attach_confirmation_links_the_row_after_the_receiver_signs(db_session, seeded_phase_event):
    # A synthetic UUID would violate the real FK on handover_confirmation_id in this test
    # database (Postgres), so a genuine handover_confirmations row is created here via
    # record_handover_confirmation — same as Stage 2B's end-to-end flow will produce.
    _, token = await _fresh_token(db_session, seeded_phase_event)
    v = await record_consent(db_session, token=token, consent_text=_CONSENT)
    artifact = EvidenceArtifact(
        id=uuid.uuid4(), trip_id=token.trip_id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{token.trip_id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts",
        file_hash="a" * 64, mime_type="image/png",
        captured_at=datetime.now(UTC),
    )
    db_session.add(artifact)
    await db_session.flush()
    confirmation = await record_handover_confirmation(
        db_session, token=token, signature_artifact_id=artifact.id,
        receiver_lat=None, receiver_lng=None, receiver_accuracy_m=None,
        receiver_ip=None, receiver_user_agent=None, bearer_token_present=False,
    )

    await attach_confirmation(
        db_session, token_id=token.id, handover_confirmation_id=confirmation.id,
    )

    await db_session.refresh(v)
    assert v.handover_confirmation_id == confirmation.id
