"""FP-83 C7: the custody chain and late evidence in an audit pack manifest."""

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, IdvsStatus, SubjectType
from app.db.models.trips import DriverSubstitution
from app.orchestration.audit_packs.analysis import derive_observations
from app.orchestration.audit_packs.builder import build_audit_manifest
from app.orchestration.substitutions.late_evidence import retain_late_evidence
from app.orchestration.substitutions.service import (
    arrange_substitution, complete_attested_substitution, confirm_substitution,
)
from app.schemas.audit_pack import AuditPackManifest, AuditPackOptions
from app.schemas.driver_substitutions import CompleteSubstitutionRequest, SubstitutionRequestRead
from tests.integration._driver_substitution_world import SubWorld
from tests.integration.test_driver_substitution_late_evidence import late
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - clock is an autouse fixture
    NOW, arrangement, capture, clock, dispatcher, driver_actor, set_identity, world_with_licences,
)


async def handover(db: AsyncSession, w: SubWorld, *, outgoing: uuid.UUID, incoming: uuid.UUID) -> SubstitutionRequestRead:
    """Arrange and confirm one handover with the real lifecycle service."""
    await set_identity(db, incoming, IdvsStatus.VERIFIED)
    pending = await arrange_substitution(db, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=incoming))
    first = await confirm_substitution(
        db, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db, outgoing), payload=capture(w, pending.version),
    )
    return await confirm_substitution(
        db, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db, incoming), payload=capture(w, first.version),
    )


async def manifest_for(db: AsyncSession, w: SubWorld) -> AuditPackManifest:
    return await build_audit_manifest(
        db, trip_id=w.trip_id, operator_organization_id=w.org_id, options=AuditPackOptions(), generated_at=NOW + timedelta(hours=1),
    )


async def test_audit_crew_uses_sequence_and_period_identity(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    await handover(db_session, w, outgoing=w.a, incoming=w.b)
    await handover(db_session, w, outgoing=w.b, incoming=w.c)
    # The third takeover is by A again, whose identity is PENDING: an admin attests it.
    await set_identity(db_session, w.a, IdvsStatus.PENDING)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w, incoming=w.a))
    first = await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.c), payload=capture(w, 1),
    )
    second = await confirm_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.a), payload=capture(w, first.version),
    )
    await complete_attested_substitution(
        db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w, admin=True),
        payload=CompleteSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=second.version,
                                            identity_unavailable_reason="IDVS outage"),
    )
    # Contradict chronology: the newest amendment claims the earliest time.
    rows = list((await db_session.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == w.trip_id).order_by(DriverSubstitution.sequence_number)
    )).scalars())
    rows[2].substitution_at = rows[0].substitution_at - timedelta(minutes=5)
    await db_session.flush()

    manifest = await manifest_for(db_session, w)

    subs = manifest.driver.substitutions
    assert [s.sequence_number for s in subs] == [1, 2, 3]
    assert [s.incoming_identity_status for s in subs] == ["verified", "verified", "pending"]
    # The arranger, the completing actor and the attesting admin are distinct recorded facts.
    assert (subs[0].completed_by, subs[2].completed_by) == ("driver", "dispatcher")
    assert (subs[2].arranged_by_name, subs[2].identity_attested_by_name) == ("D", "D")
    assert subs[2].identity_attested_at is not None and subs[0].identity_attested_at is None
    assert [d.role for d in subs[0].declarations] == ["outgoing", "incoming"]
    assert all(s.commitment_sha256 and len(s.commitment_sha256) == 64 for s in subs)
    texts = [o.text for o in derive_observations(manifest)]
    assert any("(original driver, at the start of the trip)" in t for t in texts)
    assert any("amendment 3" in t and "incoming driver identity pending" in t and "attested" in t for t in texts)


async def test_late_evidence_appears_as_retained_not_anchored(db_session: AsyncSession):
    w = await world_with_licences(db_session)
    await handover(db_session, w, outgoing=w.a, incoming=w.b)
    receipt = await retain_late_evidence(db_session, trip_id=w.trip_id, driver=await driver_actor(db_session, w.a), payload=late(0))

    manifest = await manifest_for(db_session, w)

    [record] = manifest.late_evidence
    assert (record.evidence_id, record.custody_sequence, record.status, record.kind) == (receipt.id, 0, "awaiting_review", "exception")
    texts = [o.text for o in derive_observations(manifest)]
    assert any("retained for review and did not complete a phase" in t for t in texts)


async def test_a_trip_without_handovers_keeps_its_original_identity_wording(db_session: AsyncSession):
    w = await world_with_licences(db_session)

    manifest = await manifest_for(db_session, w)

    assert manifest.driver.substitutions == [] and manifest.late_evidence == []
    assert "Driver identity check for this trip: verified." in [o.text for o in derive_observations(manifest)]

async def test_pack_names_actual_completer_and_each_clarification(db_session: AsyncSession):
    from app.db.models.people import User
    from app.orchestration.substitutions.service import correct_completed_substitution
    from app.schemas.driver_substitutions import CorrectSubstitutionRequest
    from app.schemas.people import UserRead
    w = await world_with_licences(db_session)
    await set_identity(db_session, w.b, IdvsStatus.PENDING)
    pending = await arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=arrangement(w))
    first = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.a), payload=capture(w, 1))
    blocked = await confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=await driver_actor(db_session, w.b), payload=capture(w, first.version))
    completer = User(id=uuid.uuid4(), organization_id=w.org_id, email=f'{uuid.uuid4()}@example.com', full_name='Fixture Completing Dispatcher')
    db_session.add(completer)
    await db_session.flush()
    await db_session.refresh(completer)
    author = UserRead.model_validate(completer)
    author.role = dispatcher(w, admin=True).role
    read = await complete_attested_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=author,
        payload=CompleteSubstitutionRequest(client_request_id=uuid.uuid4(), expected_version=blocked.version, identity_unavailable_reason='Identity service unavailable'))
    row = await db_session.get(DriverSubstitution, read.completed_substitution_id)
    assert row is not None
    for note in ('Gate 2', 'Spare strap retained'):
        await correct_completed_substitution(db_session, trip_id=w.trip_id, substitution_id=row.id, actor=author,
            payload=CorrectSubstitutionRequest(client_request_id=uuid.uuid4(), reason='Clarify record', correction_note=note))

    manifest = await manifest_for(db_session, w)
    [record] = manifest.driver.substitutions

    assert manifest.manifest_version == 4
    assert record.completed_by_user_id == completer.id
    assert record.completed_by_name == 'Fixture Completing Dispatcher'
    assert record.arranged_by_name == 'D'
    assert {c.correction_note for c in record.corrections} == {'Gate 2', 'Spare strap retained'}
    assert all(c.recorded_by_user_id == completer.id and c.event_hash for c in record.corrections)


async def test_pack_tier_follows_the_substitution_anchor_status_not_just_the_receipt_link(db_session: AsyncSession):
    """WI-07: a linked receipt on a row whose anchor is not ANCHORED must not read as anchored."""
    w = await world_with_licences(db_session)
    await handover(db_session, w, outgoing=w.a, incoming=w.b)
    row = (await db_session.execute(
        select(DriverSubstitution).where(DriverSubstitution.trip_id == w.trip_id)
    )).scalar_one()
    receipt = BlockchainReceipt(
        trip_id=w.trip_id, subject_type=SubjectType.DRIVER_SUBSTITUTION, subject_id=row.id,
        receipt_type=BlockchainReceiptType.DRIVER_SUBSTITUTION, data_hash="0" * 64, payload_json={},
    )
    db_session.add(receipt)
    await db_session.flush()
    assert row.anchor_status == AnchorStatus.PENDING.value  # the real completion leaves it owed
    tiers = {}

    tiers["pending, no receipt"] = (await manifest_for(db_session, w)).driver.substitutions[0].tier
    row.blockchain_receipt_id = receipt.id
    await db_session.flush()
    tiers["pending, receipt linked"] = (await manifest_for(db_session, w)).driver.substitutions[0].tier
    row.anchor_status = AnchorStatus.ANCHORED.value
    await db_session.flush()
    tiers["anchored"] = (await manifest_for(db_session, w)).driver.substitutions[0].tier

    assert tiers == {"pending, no receipt": "recorded", "pending, receipt linked": "recorded", "anchored": "anchored"}
