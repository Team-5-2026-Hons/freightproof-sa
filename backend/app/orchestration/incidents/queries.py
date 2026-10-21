"""Read incidents back: one in full (facts, ledger, grouped exceptions, affected parcels with their
scan facts, declarations), or a list for the dispatcher's triage.

Scan facts are stated as scan facts. A parcel scanned out with no scan-in reads
"no_scan_in_recorded" — never "stolen", which is a conclusion only a finding may record.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import ExceptionReviewStatus, IncidentType, IncidentUpdateKind, TripStatus
from app.db.models.incidents import Incident, IncidentException, IncidentParcel, IncidentUpdate
from app.db.models.people import User
from app.db.models.transit import TripException
from app.db.models.trips import Consignment, Parcel, Trip
from app.orchestration.audit_packs.incident_declarations import load_declarations
from app.orchestration.incidents.creation import reference
from app.orchestration.incidents.response_guide import GuideFacts, build_response_guide
from app.schemas.audit_pack import IncidentDeclarationRecord
from app.schemas.incidents import (
    IncidentDetail,
    IncidentExceptionRead,
    IncidentListFilters,
    IncidentParcelRead,
    IncidentRead,
    IncidentUpdateRead,
    ParcelScanState,
    ResponseStep,
)

# A list is triage, not an archive: the newest first, bounded.
INCIDENT_LIST_LIMIT = 200

_Assignee = aliased(User)


def scan_state(parcel: Parcel) -> ParcelScanState:
    if parcel.pp_scan_in_at is not None:
        return "scanned_in"
    if parcel.pp_scan_out_at is not None:
        return "no_scan_in_recorded"
    return "no_scan_recorded"


def _base() -> Select[tuple[Incident, Trip, str]]:
    # str, not str | None: SQLAlchemy types the outer-joined name non-null; rows still yield None.
    return (
        select(Incident, Trip, _Assignee.full_name)
        .join(Trip, Trip.id == Incident.trip_id)
        .outerjoin(_Assignee, _Assignee.id == Incident.assigned_to_user_id)
    )


@dataclass(frozen=True)
class _Aggregates:
    """Per-incident counts for a page of incidents, fetched in two queries rather than per row."""

    exception_ids: dict[uuid.UUID, list[uuid.UUID]]
    exceptions_reviewed: Counter[uuid.UUID]
    parcels_total: Counter[uuid.UUID]
    parcels_unresolved: Counter[uuid.UUID]


async def _aggregates(db: AsyncSession, incident_ids: Sequence[uuid.UUID]) -> _Aggregates:
    exception_rows = (await db.execute(
        select(IncidentException.incident_id, IncidentException.exception_id, TripException.review_status)
        .join(TripException, TripException.id == IncidentException.exception_id)
        .where(IncidentException.incident_id.in_(incident_ids))
        .order_by(IncidentException.created_at)
    )).tuples().all()
    parcel_rows = (await db.execute(
        select(IncidentParcel.incident_id, IncidentParcel.latest_finding).where(IncidentParcel.incident_id.in_(incident_ids))
    )).tuples().all()
    exception_ids: dict[uuid.UUID, list[uuid.UUID]] = {}
    for incident_id, exception_id, _ in exception_rows:
        exception_ids.setdefault(incident_id, []).append(exception_id)
    return _Aggregates(
        exception_ids=exception_ids,
        exceptions_reviewed=Counter(i for i, _, status in exception_rows if status == ExceptionReviewStatus.REVIEWED),
        parcels_total=Counter(i for i, _ in parcel_rows),
        parcels_unresolved=Counter(i for i, finding in parcel_rows if finding is None),
    )


def _summary(incident: Incident, trip: Trip, assignee_name: str | None, agg: _Aggregates) -> IncidentRead:
    linked = agg.exception_ids.get(incident.id, [])
    return IncidentRead(
        incident_id=incident.id, reference=reference(incident), trip_id=trip.id, trip_reference=trip.trip_reference,
        trip_status=trip.status, incident_type=incident.incident_type, summary=incident.summary,
        status=incident.status, confidence=incident.confidence, outcome=incident.outcome,
        assigned_to_user_id=incident.assigned_to_user_id, assigned_to_name=assignee_name,
        reported_occurred_at=incident.reported_occurred_at, received_at=incident.received_at,
        trip_stopped_at=incident.trip_stopped_at, closed_at=incident.closed_at, created_at=incident.created_at,
        exception_ids=linked, exceptions_total=len(linked), exceptions_reviewed=agg.exceptions_reviewed[incident.id],
        parcels_total=agg.parcels_total[incident.id], parcels_unresolved=agg.parcels_unresolved[incident.id],
    )


async def list_incidents(
    db: AsyncSession, *, organization_id: uuid.UUID, filters: IncidentListFilters,
) -> list[IncidentRead]:
    query = _base().where(Trip.operator_organization_id == organization_id)
    if filters.trip_id is not None:
        # A trip that is not this operator's is a 404, not an empty list.
        owned = (await db.execute(
            select(Trip.id).where(Trip.id == filters.trip_id, Trip.operator_organization_id == organization_id)
        )).scalar_one_or_none()
        if owned is None:
            raise ResourceNotFoundError("Trip", str(filters.trip_id))
        query = query.where(Incident.trip_id == filters.trip_id)
    if filters.status is not None:
        query = query.where(Incident.status == filters.status)
    if filters.incident_type is not None:
        query = query.where(Incident.incident_type == filters.incident_type)
    if filters.assigned_to is not None:
        query = query.where(Incident.assigned_to_user_id == filters.assigned_to)
    rows = (await db.execute(query.order_by(Incident.created_at.desc()).limit(INCIDENT_LIST_LIMIT))).tuples().all()
    agg = await _aggregates(db, [incident.id for incident, _, _ in rows])
    return [_summary(incident, trip, name, agg) for incident, trip, name in rows]


async def _updates(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentUpdateRead]:
    rows = (await db.execute(
        select(IncidentUpdate, User.full_name)
        .outerjoin(User, User.id == IncidentUpdate.recorded_by_user_id)
        .where(IncidentUpdate.incident_id == incident_id)
        .order_by(IncidentUpdate.sequence)
    )).tuples().all()
    return [
        IncidentUpdateRead(
            update_id=row.id, sequence=row.sequence, kind=row.kind, note=row.note, from_value=row.from_value,
            to_value=row.to_value, parcel_id=row.parcel_id, exception_id=row.exception_id,
            phase_event_id=row.phase_event_id, artifact_id=row.artifact_id, external_action=row.external_action,
            action_at=row.action_at, recorded_by_user_id=row.recorded_by_user_id, recorded_by_name=name,
            recorded_at=row.created_at,
        )
        for row, name in rows
    ]


async def _exceptions(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentExceptionRead]:
    rows = (await db.execute(
        select(IncidentException, TripException)
        .join(TripException, TripException.id == IncidentException.exception_id)
        .where(IncidentException.incident_id == incident_id)
        .order_by(TripException.created_at)
    )).tuples().all()
    return [
        IncidentExceptionRead(
            exception_id=exc.id, exception_type=exc.exception_type, severity=exc.severity,
            description=exc.description, review_status=exc.review_status, raised_at=exc.created_at,
            linked_at=link.created_at,
        )
        for link, exc in rows
    ]


async def _parcels(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentParcelRead]:
    rows = (await db.execute(
        select(IncidentParcel, Parcel, Consignment)
        .join(Parcel, Parcel.id == IncidentParcel.parcel_id)
        .join(Consignment, Consignment.id == Parcel.consignment_id)
        .where(IncidentParcel.incident_id == incident_id)
        .order_by(Consignment.parcel_perfect_reference, Parcel.barcode)
    )).tuples().all()
    return [
        IncidentParcelRead(
            parcel_id=parcel.id, barcode=parcel.barcode, description=parcel.description,
            consignment_id=consignment.id, consignment_reference=consignment.parcel_perfect_reference,
            delivery_stop=parcel.delivery_stop, scanned_out_at=parcel.pp_scan_out_at,
            scanned_in_at=parcel.pp_scan_in_at, scan_state=scan_state(parcel),
            latest_finding=named.latest_finding, added_at=named.created_at,
        )
        for named, parcel, consignment in rows
    ]


async def _guide(
    db: AsyncSession, incident: Incident, trip: Trip, updates: Sequence[IncidentUpdateRead],
    declarations: Sequence[IncidentDeclarationRecord],
) -> list[ResponseStep] | None:
    if incident.incident_type != IncidentType.HIJACKING:
        return None
    # A pack issued before the incident was recorded cannot contain it, so it does not count.
    pack_issued_at = (await db.execute(
        select(func.min(AuditPack.issued_at)).where(AuditPack.trip_id == trip.id, AuditPack.issued_at >= incident.created_at)
    )).scalar_one_or_none()
    actions = [
        (u.external_action, u.action_at or u.recorded_at)
        for u in updates if u.kind == IncidentUpdateKind.EXTERNAL_ACTION and u.external_action is not None
    ]
    return build_response_guide(GuideFacts(
        trip_stopped_at=incident.trip_stopped_at, trip_status=TripStatus(trip.status), actions=actions,
        declarations=declarations, pack_issued_at=pack_issued_at,
    ))


async def get_incident_detail(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, warnings: Sequence[str] = (),
) -> IncidentDetail:
    row = (await db.execute(
        _base().where(Incident.id == incident_id, Trip.operator_organization_id == organization_id)
    )).tuples().one_or_none()
    if row is None:
        raise ResourceNotFoundError("Incident", str(incident_id))
    incident, trip, assignee_name = row
    recorder = (await db.execute(select(User.full_name).where(User.id == incident.recorded_by_user_id))).scalar_one_or_none()
    # This incident's own declarations and the trip-level ones made outside any incident: the
    # same rule the close warning and the pack's case-number check use, so all three agree.
    declarations = [d for d in await load_declarations(db, trip_id=trip.id) if d.incident_id in (incident.id, None)]
    summary = _summary(incident, trip, assignee_name, await _aggregates(db, [incident.id]))
    updates = await _updates(db, incident.id)
    return IncidentDetail(
        **summary.model_dump(),
        reported_by_name=incident.reported_by_name, reporter_role=incident.reporter_role,
        report_channel=incident.report_channel, recorded_by_user_id=incident.recorded_by_user_id,
        recorded_by_name=recorder, closure_reason=incident.closure_reason,
        exceptions=await _exceptions(db, incident.id), parcels=await _parcels(db, incident.id),
        updates=updates, declarations=declarations,
        document_upload_enabled=settings.INCIDENT_DOCUMENTS_ENABLED, warnings=list(warnings),
        response_guide=await _guide(db, incident, trip, updates, declarations),
    )
