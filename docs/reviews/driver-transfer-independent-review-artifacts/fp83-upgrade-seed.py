import asyncio
import json
import uuid
import hashlib
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from sqlalchemy import event, text, select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.config import settings
from app.db.models.people import Driver, User
from app.db.models.trips import DriverSubstitution
from app.orchestration.substitutions import service, anchors
from app.orchestration.audit_packs import lifecycle
from app.schemas.audit_pack import AuditPackCreate
from app.schemas.driver_substitutions import ReplaceSubstitutionRequest
from tests.integration.test_driver_substitution_service import (
 NOW, world_with_licences, set_identity, dispatcher, arrangement, capture, driver_actor,
)
from app.db.models.enums import IdvsStatus
from tests.integration.test_driver_substitution_anchors import FakeHedera
import app.blockchain.anchor_service as anchor_service

@event.listens_for(Session, 'before_flush')
def auth_rows(session, *_):
    for row in list(session.new):
        if isinstance(row, (Driver, User)):
            session.connection().execute(text('INSERT INTO auth.users(id) VALUES (:id) ON CONFLICT DO NOTHING'), {'id': row.id})

service.utcnow=lambda:NOW
anchors.dispatch_custody_anchor=lambda *args, **kwargs: None
anchor_service.HederaService=lambda:FakeHedera()
async def no_fix(*args, **kwargs): return None
service.capture_assessment.read_horse_fix=no_fix
store=Path('/tmp/fp83-issued-v2.pdf')
async def upload_pdf(*, trip_id, pack_id, pdf_bytes):
    store.write_bytes(pdf_bytes)
    return SimpleNamespace(s3_bucket='test',s3_key='issued-v2.pdf',file_hash=hashlib.sha256(pdf_bytes).hexdigest())
lifecycle.upload_audit_pack_pdf=upload_pdf

async def main():
    engine=create_async_engine(settings.DATABASE_URL)
    data={}
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        for kind in ('legacy','anchored','owed','outgoing_saved','incoming_saved','replacement'):
            w=await world_with_licences(db)
            await set_identity(db,w.b,IdvsStatus.VERIFIED)
            info={'world':asdict(w)}
            if kind=='legacy':
                row=DriverSubstitution(id=uuid.uuid4(),trip_id=w.trip_id,original_driver_id=w.a,
                    substituting_driver_id=w.b,exchange_location='Historical depot',approving_dispatcher_user_id=w.user_id,
                    is_planned=True,substitution_at=NOW,sequence_number=1)
                db.add(row); await db.flush()
                info['substitution']=row.id
            else:
                body=arrangement(w)
                read=await service.arrange_substitution(db,trip_id=w.trip_id,actor=dispatcher(w),payload=body)
                info.update(arrange_body=body.model_dump(mode='json'),request_id=read.id)
                if kind=='replacement':
                    replacement=ReplaceSubstitutionRequest(**arrangement(w,incoming=w.c).model_dump(),
                        expected_version=read.version,replacement_reason='Fixture replacement')
                    result=await service.replace_substitution(db,trip_id=w.trip_id,request_id=read.id,
                        actor=dispatcher(w),payload=replacement)
                    info.update(replace_body=replacement.model_dump(mode='json'),replacement_id=result.replacement_request_id)
                else:
                    first=w.b if kind=='incoming_saved' else w.a
                    read=await service.confirm_substitution(db,trip_id=w.trip_id,request_id=read.id,
                        actor=await driver_actor(db,first),payload=capture(w,read.version))
                    second=w.a if first==w.b else w.b
                    offline=capture(w,read.version)
                    info.update(offline_body=offline.model_dump(mode='json'),second_actor=second)
                    if kind in ('anchored','owed'):
                        read=await service.confirm_substitution(db,trip_id=w.trip_id,request_id=read.id,
                            actor=await driver_actor(db,second),payload=offline)
                        row=await db.get(DriverSubstitution,read.completed_substitution_id)
                        info['substitution']=row.id
                        if kind=='anchored':
                            assert await anchors.anchor_custody_record(db,kind=anchors.CustodyAnchorKind.SUBSTITUTION,record_id=row.id)
                            issued=await lifecycle.issue_audit_pack(db,trip_id=w.trip_id,issued_by=dispatcher(w),
                                request=AuditPackCreate(recipient_name='Fixture Reviewer',recipient_organization='Fixture Claims',
                                    recipient_email='reviewer@example.invalid',purpose='insurance_claim'),now=NOW)
                            assert issued.pack.manifest_version==2
                            info['pack_id']=issued.pack.id
            data[kind]=info
        await db.commit()
        for table in ('driver_substitution_requests','driver_substitution_confirmations','driver_substitutions',
                      'driver_substitution_operations','blockchain_receipts','audit_packs'):
            data['snapshot_'+table]=(await db.execute(text(f'SELECT to_jsonb(t) FROM {table} t ORDER BY id'))).scalars().all()
    Path('/tmp/fp83-upgrade-before.json').write_text(json.dumps(data,default=str,sort_keys=True,indent=2))
    await engine.dispose()
    print('Seeded legacy, anchored/owed v1, both one-capture orders, accepted arrange/replace and actual issued v2 PDF/manifest.')

asyncio.run(main())
