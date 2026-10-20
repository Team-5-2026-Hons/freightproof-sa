"""Immediate transfer policy, old replay compatibility and immutable custody."""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SubstitutionInvalidError
from app.db.models.driver_substitutions import DriverSubstitutionConfirmation, DriverSubstitutionOperation, DriverSubstitutionRequest
from app.db.models.enums import IdvsStatus
from app.db.models.trips import DriverSubstitution, Trip
from app.orchestration.substitutions import service
from app.schemas import driver_substitutions as ds
from tests.integration.test_driver_substitution_service import (  # noqa: F401 - autouse clock
    NOW, armed, arrangement, capture, clock, completion, dispatcher, driver_actor, get_row, set_identity, world_with_licences,
)  # noqa: F401 - autouse test clock


def immediate(w, **changes):
    return ds.ArrangeImmediateSubstitutionRequest(client_request_id=uuid.uuid4(), request_format='immediate_v2', incoming_driver_id=w.b, reason='Immediate relief', **changes)


async def arranged(db, *, verified=True):
    w = await world_with_licences(db)
    if verified:
        await set_identity(db, w.b, IdvsStatus.VERIFIED)
    read = await service.arrange_substitution(db, trip_id=w.trip_id, actor=dispatcher(w), payload=immediate(w))
    return w, read


async def test_immediate_arrange_needs_no_planning_fields(db_session):
    w, read = await arranged(db_session)
    row = await get_row(db_session, DriverSubstitutionRequest, read.id)
    assert (read.exchange, read.expected_at, read.is_planned) == (None, None, None)
    assert row.reservation_start_at == NOW and row.request_format == 'immediate_v2'
    assert read.missing_confirmations == [ds.SubstitutionRole.INCOMING]
    assert 'confirm_outgoing' not in [str(a.value) for a in read.permitted_actions]
    assert (await get_row(db_session, Trip, w.trip_id)).driver_id == w.a


async def test_v2_completes_with_only_incoming_acceptance_and_outgoing_offline(db_session):
    w, pending = await arranged(db_session)
    result = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=capture(w, pending.version))
    row = (await db_session.execute(select(DriverSubstitution).where(DriverSubstitution.trip_id == w.trip_id))).scalar_one()
    captures = list((await db_session.execute(select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id == pending.id))).scalars())
    assert result.state == ds.SubstitutionState.COMPLETED
    assert result.missing_confirmations == []
    assert [c.role for c in captures] == ['incoming']
    assert row.payload_version == 2 and row.payload_json['captures']['outgoing'] is None
    assert row.payload_json['required_confirmation_roles'] == ['incoming']
    assert 'exchange_sha256' not in row.payload_json and 'is_planned' not in row.payload_json
    assert (await get_row(db_session, Trip, w.trip_id)).driver_id == w.a


async def test_v2_cannot_complete_before_incoming_acceptance(db_session):
    w, pending = await arranged(db_session)
    with pytest.raises(SubstitutionInvalidError, match='Incoming driver must accept'):
        await service.complete_attested_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
            actor=dispatcher(w, admin=True), payload=completion(pending.version, missing='Outgoing offline'))


async def test_v2_outgoing_cannot_confirm(db_session):
    w, pending = await arranged(db_session)
    with pytest.raises(SubstitutionInvalidError):
        await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
            actor=await driver_actor(db_session, w.a), payload=capture(w, pending.version))


async def test_v1_to_v2_replace_inherits_no_confirmations(db_session):
    w, pending = await armed(db_session)
    saved = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.a), payload=capture(w, pending.version))
    result = await service.replace_substitution(db_session, trip_id=w.trip_id, request_id=pending.id, actor=dispatcher(w),
        payload=ds.ReplaceImmediateSubstitutionRequest(**immediate(w).model_dump(), expected_version=saved.version, replacement_reason='Use immediate acceptance'))
    replacement = await get_row(db_session, DriverSubstitutionRequest, result.replacement_request_id)
    assert replacement.request_format == 'immediate_v2'
    assert not list((await db_session.execute(select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id == replacement.id))).scalars())


async def test_old_operation_digest_and_result_survive_upgrade(db_session):
    w = await world_with_licences(db_session)
    payload = arrangement(w)
    accepted = await service.arrange_substitution(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=payload)
    operation = (await db_session.execute(select(DriverSubstitutionOperation).where(DriverSubstitutionOperation.request_id == accepted.id))).scalar_one()
    before = (operation.body_digest, operation.result_json.copy())
    from app.orchestration.substitutions.client_operations import arrange_immediate_or_replay
    replay = await arrange_immediate_or_replay(db_session, trip_id=w.trip_id, actor=dispatcher(w), payload=payload)
    assert replay.id == accepted.id
    assert (operation.body_digest, operation.result_json) == before
    w2 = await world_with_licences(db_session)
    with pytest.raises(SubstitutionInvalidError, match='Refresh the dispatcher'):
        await arrange_immediate_or_replay(db_session, trip_id=w2.trip_id, actor=dispatcher(w2), payload=arrangement(w2))

async def test_v2_keeps_all_four_capture_clocks_and_commits_observation(db_session):
    from app.orchestration.substitutions.reads import get_driver_context
    w, pending = await arranged(db_session)
    body = ds.ConfirmSubstitutionObservationRequest(**capture(w, pending.version).model_dump(),
        capture_format='observation_v2', location_observed_at=NOW - timedelta(minutes=1), location_unavailable_reason=None)
    result = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=body)
    context = await get_driver_context(db_session, trip_id=w.trip_id, request_id=pending.id, driver_id=w.b)
    incoming = context.confirmations[0]
    assert incoming.captured_at == body.captured_at
    assert incoming.location_observed_at == NOW - timedelta(minutes=1)
    assert incoming.received_at == result.effective_at == NOW
    assert incoming.location_observation_committed is True
    assert (incoming.latitude, incoming.longitude, incoming.accuracy_metres) == (-32.35, 22.58, 8)


@pytest.mark.parametrize('enabled', [False, True])
async def test_v2_saved_acceptance_admin_resolution_and_notices_survive_flag_off(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, enabled: bool,
) -> None:
    from app.core.config import settings
    from app.db.models.driver_substitutions import DriverSubstitutionNotice
    w, pending = await arranged(db_session, verified=False)
    monkeypatch.setattr(settings, 'DRIVER_SUBSTITUTIONS_ENABLED', enabled)
    saved = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=capture(w, pending.version))
    assert saved.completion_blocked_by is not None
    assert saved.state.value == 'pending' and saved.completion_blocked_by.value == 'identity_not_verified'
    assert saved.missing_confirmations == []
    completed = await service.complete_attested_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=dispatcher(w, admin=True), payload=completion(saved.version, identity='Fixture identity service unavailable'))
    assert completed.completion_mode is not None
    assert completed.state.value == 'completed' and completed.completion_mode.value == 'dispatcher_attested'
    assert (await get_row(db_session, Trip, w.trip_id)).driver_id == w.a
    notices = list((await db_session.execute(select(DriverSubstitutionNotice).where(
        DriverSubstitutionNotice.request_id == pending.id, DriverSubstitutionNotice.recipient_driver_id == w.a,
    ))).scalars())
    assert {notice.kind for notice in notices} == {'arranged', 'completed'}
    assert all(notice.read_at is None for notice in notices)


@pytest.mark.parametrize('condition', ['intact', 'damaged', 'missing'])
async def test_v2_single_capture_seal_findings_never_invent_outgoing_mismatch(db_session: AsyncSession, condition: str) -> None:
    from app.db.models.transit import TripException
    from tests.integration.test_driver_substitution_service import _photo
    w, pending = await arranged(db_session)
    photo = await _photo(db_session, w, driver_id=w.b, request_id=pending.id)
    check = ds.SealCheck(vehicle_id=w.horse_id, condition=condition,
        seal_number=None if condition == 'missing' else 'AB-1234', photo_artifact_ids=[photo])
    body = capture(w, pending.version, seal_checks=[check])
    result = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=body)
    replay = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=body)
    findings = list((await db_session.execute(select(TripException).where(
        TripException.trip_id == w.trip_id, TripException.substitution_confirmation_id.is_not(None),
    ))).scalars())
    assert result.state.value == 'completed' and replay.completed_substitution_id == result.completed_substitution_id
    assert [finding.exception_type for finding in findings] == ([] if condition == 'intact' else ['seal_compromised'])


async def test_completed_detail_exposes_recorded_outgoing_notices_without_claiming_consent(db_session: AsyncSession) -> None:
    from app.orchestration.substitutions.reads import get_completed_substitution
    w, pending = await arranged(db_session)
    result = await service.confirm_substitution(db_session, trip_id=w.trip_id, request_id=pending.id,
        actor=await driver_actor(db_session, w.b), payload=capture(w, pending.version))
    assert result.completed_substitution_id is not None
    detail = await get_completed_substitution(db_session, trip_id=w.trip_id,
        substitution_id=result.completed_substitution_id, actor=dispatcher(w))

    assert {notice.kind.value for notice in detail.outgoing_notices} == {'arranged', 'completed'}
    assert all(notice.read_at is None for notice in detail.outgoing_notices)
    assert [confirmation.role.value for confirmation in detail.confirmations] == ['incoming']
