import asyncio
import hashlib
import json
import uuid
from pathlib import Path
from datetime import timedelta
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.config import settings
from app.db.models.trips import DriverSubstitution, Trip
from app.db.models.driver_substitutions import DriverSubstitutionRequest, DriverSubstitutionConfirmation
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import IdvsStatus
from app.orchestration.substitutions import service, anchors
from app.orchestration.substitutions.client_operations import arrange_immediate_or_replay, replace_immediate_or_replay
from app.orchestration.substitutions.reads import get_completed_substitution
from app.schemas import driver_substitutions as ds
from tests.integration._driver_substitution_world import SubWorld
from tests.integration.test_driver_substitution_service import NOW, dispatcher, capture, driver_actor, set_identity
from tests.integration.test_driver_substitution_anchors import FakeHedera
import app.blockchain.anchor_service as anchor_service

before=json.loads(Path('/tmp/fp83-upgrade-before.json').read_text())
service.utcnow=lambda:NOW+timedelta(hours=1)
anchors.dispatch_custody_anchor=lambda *args,**kwargs:None
fake=FakeHedera()
fake.submitted=[r['data_hash'] for r in before['snapshot_blockchain_receipts']]
anchor_service.HederaService=lambda:fake
async def no_fix(*args,**kwargs):return None
service.capture_assessment.read_horse_fix=no_fix

def world(kind):return SubWorld(**{k:uuid.UUID(v) for k,v in before[kind]['world'].items()})

async def main():
    engine=create_async_engine(settings.DATABASE_URL)
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        assert (await db.scalar(text('SHOW server_version'))).startswith('17.')
        for key,old_rows in before.items():
            if not key.startswith('snapshot_'):continue
            table=key.removeprefix('snapshot_')
            now=(await db.execute(text(f'SELECT to_jsonb(t) FROM {table} t ORDER BY id'))).scalars().all()
            assert [{k:r[k] for k in old} for old,r in zip(old_rows,now)]==old_rows,(table,'historical fields changed')
            assert len(now)==len(old_rows)
        print('PASS every pre-upgrade field/hash/operation/result/receipt/issued-manifest preserved')
        settings.DRIVER_SUBSTITUTIONS_ENABLED=False
        for kind in ('anchored','owed','outgoing_saved','incoming_saved','replacement'):
            w=world(kind); item=before[kind]
            await arrange_immediate_or_replay(db,trip_id=w.trip_id,actor=dispatcher(w),
                payload=ds.ArrangeSubstitutionRequest.model_validate(item['arrange_body']))
            if kind=='replacement':
                replay=await replace_immediate_or_replay(db,trip_id=w.trip_id,request_id=uuid.UUID(item['request_id']),
                    actor=dispatcher(w),payload=ds.ReplaceSubstitutionRequest.model_validate(item['replace_body']))
                assert str(replay.replacement_request_id)==item['replacement_id']
        print('PASS actual pre-upgrade accepted arrange/replace replay with flag off')
        for kind in ('outgoing_saved','incoming_saved'):
            w=world(kind); item=before[kind]
            body=ds.ConfirmSubstitutionRequest.model_validate(item['offline_body'])
            result=await service.confirm_substitution(db,trip_id=w.trip_id,request_id=uuid.UUID(item['request_id']),
                actor=await driver_actor(db,uuid.UUID(item['second_actor'])),payload=body)
            row=await db.get(DriverSubstitution,result.completed_substitution_id)
            assert result.state.value=='completed' and row.payload_version==1
            assert set(row.payload_json['captures'])=={'outgoing','incoming'}
            assert (await service.confirm_substitution(db,trip_id=w.trip_id,request_id=result.id,
                actor=await driver_actor(db,uuid.UUID(item['second_actor'])),payload=body)).id==result.id
        print('PASS one-capture v1 upgrade and unchanged offline second body in both orders with flag off')
        w=world('legacy')
        detail=await get_completed_substitution(db,trip_id=w.trip_id,substitution_id=uuid.UUID(before['legacy']['substitution']),actor=dispatcher(w))
        assert detail.request_id is None and detail.confirmation_policy is None and detail.confirmations==[]
        assert detail.custody_integrity.status.value=='pending'
        for kind in ('anchored','owed'):
            w=world(kind); row=await db.get(DriverSubstitution,uuid.UUID(before[kind]['substitution']))
            assert await anchors.anchor_custody_record(db,kind=anchors.CustodyAnchorKind.SUBSTITUTION,record_id=row.id)
            integrity=await anchors.verify_custody_chain(db,trip_id=w.trip_id,organization_id=w.org_id)
            assert integrity.status.value=='verified',integrity
            assert row.payload_version==1
        print('PASS request-less unknown history, old receipt binding and owed v1 anchor recovery')
        settings.DRIVER_SUBSTITUTIONS_ENABLED=True
        w=world('anchored')
        await set_identity(db,w.c,IdvsStatus.VERIFIED)
        new=await arrange_immediate_or_replay(db,trip_id=w.trip_id,actor=dispatcher(w),payload=ds.ArrangeImmediateSubstitutionRequest(
            client_request_id=uuid.uuid4(),request_format='immediate_v2',incoming_driver_id=w.c,reason='Mixed chain fixture'))
        body=ds.ConfirmSubstitutionObservationRequest(**capture(w,new.version).model_dump(),capture_format='observation_v2',
            location_observed_at=NOW,location_unavailable_reason=None)
        result=await service.confirm_substitution(db,trip_id=w.trip_id,request_id=new.id,actor=await driver_actor(db,w.c),payload=body)
        row=await db.get(DriverSubstitution,result.completed_substitution_id)
        assert row.sequence_number==2 and row.payload_version==2
        assert row.payload_json['previous_event_hash']==next(r['event_hash'] for r in before['snapshot_driver_substitutions'] if r['id']==before['anchored']['substitution'])
        assert await anchors.anchor_custody_record(db,kind=anchors.CustodyAnchorKind.SUBSTITUTION,record_id=row.id)
        assert (await anchors.verify_custody_chain(db,trip_id=w.trip_id,organization_id=w.org_id)).status.value=='verified'
        assert (await db.get(Trip,w.trip_id)).driver_id==w.a
        w=world('replacement'); item=before['replacement']
        request=await db.get(DriverSubstitutionRequest,uuid.UUID(item['replacement_id']))
        replaced=await replace_immediate_or_replay(db,trip_id=w.trip_id,request_id=request.id,actor=dispatcher(w),
            payload=ds.ReplaceImmediateSubstitutionRequest(client_request_id=uuid.uuid4(),request_format='immediate_v2',
                incoming_driver_id=w.b,reason='Immediate policy',expected_version=request.version,replacement_reason='Explicitly adopt v2'))
        assert await db.scalar(select(DriverSubstitutionConfirmation.id).where(DriverSubstitutionConfirmation.request_id==replaced.replacement_request_id)) is None
        print('PASS migrated database v2 insertion/shape, mixed-chain verification, fresh v1-to-v2 replacement')
        for old in before['snapshot_audit_packs']:
            current=await db.get(AuditPack,uuid.UUID(old['id']))
            assert current.manifest_json==old['manifest_json'] and current.manifest_sha256==old['manifest_sha256']
            assert hashlib.sha256(Path('/tmp/fp83-issued-v2.pdf').read_bytes()).hexdigest()==current.pdf_sha256
            assert current.manifest_version==2
        print('PASS actual issued v2 manifest and PDF hash/bytes unchanged after upgrade and later transfer')
        await db.commit()
    await engine.dispose()

asyncio.run(main())
