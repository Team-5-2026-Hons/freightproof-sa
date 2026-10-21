"""Incidents as the audit pack records them: one InvestigationRecord per incident on the trip.

Called by audit_packs.builder with the pack's scope already resolved. A consignment-scoped pack
(issued to one client) keeps the incident itself — a hijacking concerns the whole load — but cuts
every parcel, and every ledger entry naming a parcel, from the other clients' consignments, and
every exception the pack's own scope already cut.
"""

import uuid
from collections.abc import Collection

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.models.enums import IncidentType, enum_text
from app.db.models.incidents import Incident, IncidentException, IncidentParcel, IncidentUpdate
from app.db.models.people import User
from app.db.models.trips import Parcel
from app.orchestration.incidents.creation import reference
from app.orchestration.incidents.queries import scan_state
from app.schemas.audit_pack import AffectedParcelRecord, InvestigationEntryRecord, InvestigationRecord

_Assignee = aliased(User)

SCOPE_REDACTION = (
    "Incidents, parcels and follow-up entries concerning other clients' consignments withheld at the issuer's request."
)


async def _parcels(db: AsyncSession, incident_id: uuid.UUID) -> list[AffectedParcelRecord]:
    rows = (await db.execute(
        select(IncidentParcel, Parcel).join(Parcel, Parcel.id == IncidentParcel.parcel_id)
        .where(IncidentParcel.incident_id == incident_id).order_by(Parcel.barcode)
    )).tuples().all()
    return [
        AffectedParcelRecord(
            parcel_id=parcel.id, barcode=parcel.barcode, consignment_id=parcel.consignment_id,
            scan_state=scan_state(parcel),
            latest_finding=enum_text(named.latest_finding) if named.latest_finding else None,
        )
        for named, parcel in rows
    ]


async def _entries(db: AsyncSession, incident_id: uuid.UUID) -> list[InvestigationEntryRecord]:
    rows = (await db.execute(
        select(IncidentUpdate, User.full_name).outerjoin(User, User.id == IncidentUpdate.recorded_by_user_id)
        .where(IncidentUpdate.incident_id == incident_id).order_by(IncidentUpdate.sequence)
    )).tuples().all()
    return [
        InvestigationEntryRecord(
            sequence=row.sequence, kind=enum_text(row.kind), note=row.note, from_value=row.from_value,
            to_value=row.to_value, parcel_id=row.parcel_id, exception_id=row.exception_id,
            external_action=enum_text(row.external_action) if row.external_action else None,
            action_at=row.action_at, recorded_by_name=name, recorded_at=row.created_at,
        )
        for row, name in rows
    ]


async def load_investigations(
    db: AsyncSession, *, trip_id: uuid.UUID, visible_consignment_ids: Collection[uuid.UUID],
    included_exception_ids: Collection[uuid.UUID], scoped: bool,
) -> tuple[list[InvestigationRecord], bool]:
    """Every incident on the trip, oldest first, cut to the pack's scope. The flag says whether
    anything was cut, so the builder can name the redaction.

    In a consignment-scoped pack a hijacking stays (it concerns the whole load), but any other
    incident stays only if it names a parcel or groups an exception the pack itself shows:
    another client's shortage, its reporter and its notes, are that client's business."""
    rows = (await db.execute(
        select(Incident, _Assignee.full_name).outerjoin(_Assignee, _Assignee.id == Incident.assigned_to_user_id)
        .where(Incident.trip_id == trip_id).order_by(Incident.incident_number)
    )).tuples().all()
    records: list[InvestigationRecord] = []
    redacted = False
    for incident, assignee in rows:
        parcels = await _parcels(db, incident.id)
        visible = [p for p in parcels if p.consignment_id in visible_consignment_ids]
        hidden_parcels = {p.parcel_id for p in parcels} - {p.parcel_id for p in visible}
        linked = list((await db.execute(
            select(IncidentException.exception_id).where(IncidentException.incident_id == incident.id)
            .order_by(IncidentException.created_at)
        )).scalars().all())
        entries = [
            e for e in await _entries(db, incident.id)
            if e.parcel_id not in hidden_parcels
            and (e.exception_id is None or e.exception_id in included_exception_ids)
        ]
        in_scope = [i for i in linked if i in included_exception_ids]
        if scoped and incident.incident_type != IncidentType.HIJACKING and not visible and not in_scope:
            redacted = True
            continue
        redacted = redacted or bool(hidden_parcels)
        records.append(InvestigationRecord(
            incident_id=incident.id, reference=reference(incident), incident_type=enum_text(incident.incident_type),
            summary=incident.summary, reporter_role=enum_text(incident.reporter_role),
            report_channel=enum_text(incident.report_channel),
            reported_occurred_at=incident.reported_occurred_at, received_at=incident.received_at,
            confidence=enum_text(incident.confidence), status=enum_text(incident.status),
            outcome=enum_text(incident.outcome) if incident.outcome else None,
            closure_reason=incident.closure_reason, closed_at=incident.closed_at,
            trip_stopped_at=incident.trip_stopped_at, assigned_to_name=assignee,
            exception_ids=in_scope, parcels=visible, entries=entries,
        ))
    return records, redacted
