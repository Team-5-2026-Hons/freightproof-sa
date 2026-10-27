"""Follow-up on an incident: notes, ownership, status, confidence, more evidence, parcel findings,
external actions, closing and reopening. Every one appends to the ledger; nothing rewrites an
earlier entry, so the first assessment and everything learned since stay side by side.

Each entry point locks the incident (ledger.lock_incident), checks against the state the ledger
adds up to, then appends.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import IncidentInvalidError
from app.db.models.audit_packs import IncidentDeclaration
from app.db.models.enums import IncidentUpdateKind, enum_text
from app.db.models.incidents import Incident, IncidentParcel
from app.orchestration.incidents import guards
from app.orchestration.incidents.ledger import Entry, OpenLedger, append, lock_incident, notify
from app.orchestration.incidents.links import add_parcel, link_exception
from app.orchestration.incidents.state import check_close, check_reopen, check_status_change, close_warnings, ensure_open
from app.schemas.incidents import (
    AddParcelsUpdate,
    AssignUpdate,
    ConfidenceUpdate,
    ExternalActionUpdate,
    IncidentCloseRequest,
    IncidentReopenRequest,
    IncidentUpdateCreate,
    LinkExceptionUpdate,
    NoteUpdate,
    ParcelFindingUpdate,
    StatusUpdate,
)


async def _note(db: AsyncSession, ledger: OpenLedger, request: NoteUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    trip_id = ledger.trip.id
    if request.exception_id is not None:
        await guards.assert_exceptions_on_trip(db, trip_id=trip_id, exception_ids=[request.exception_id])
    if request.parcel_id is not None:
        await guards.assert_parcels_on_trip(db, trip_id=trip_id, parcel_ids=[request.parcel_id])
    await guards.assert_phase_on_trip(db, trip_id=trip_id, phase_event_id=request.phase_event_id)
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.NOTE, user_id=user_id, at=at, note=request.note, exception_id=request.exception_id,
        parcel_id=request.parcel_id, phase_event_id=request.phase_event_id,
    ))


def _status(db: AsyncSession, ledger: OpenLedger, request: StatusUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    check_status_change(ledger.state.status, request.status, incident_id=ledger.incident.id)
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.STATUS_CHANGED, user_id=user_id, at=at, note=request.note,
        from_value=enum_text(ledger.state.status), to_value=request.status.value,
    ))


async def _assign(
    db: AsyncSession, ledger: OpenLedger, request: AssignUpdate, *, user_id: uuid.UUID, at: datetime,
) -> None:
    if request.assigned_to_user_id == ledger.state.assigned_to:
        raise IncidentInvalidError("The incident is already assigned that way.")
    if request.assigned_to_user_id is not None:
        await guards.assert_colleague(
            db, user_id=request.assigned_to_user_id, organization_id=ledger.trip.operator_organization_id,
        )
    previous = ledger.state.assigned_to
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.ASSIGNED, user_id=user_id, at=at, note=request.note,
        from_value=str(previous) if previous else None,
        to_value=str(request.assigned_to_user_id) if request.assigned_to_user_id else None,
    ))


def _confidence(db: AsyncSession, ledger: OpenLedger, request: ConfidenceUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    if request.confidence == ledger.state.confidence:
        raise IncidentInvalidError(f"Confidence is already '{request.confidence.value}'.")
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.CONFIDENCE_CHANGED, user_id=user_id, at=at, note=request.note,
        from_value=enum_text(ledger.state.confidence), to_value=request.confidence.value,
    ))


async def _link(db: AsyncSession, ledger: OpenLedger, request: LinkExceptionUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    await guards.assert_exceptions_on_trip(db, trip_id=ledger.trip.id, exception_ids=[request.exception_id])
    await guards.assert_exceptions_unlinked(db, exception_ids=[request.exception_id])
    await link_exception(db, ledger, exception_id=request.exception_id, entry=Entry(
        kind=IncidentUpdateKind.EXCEPTION_LINKED, user_id=user_id, at=at, note=request.note,
        exception_id=request.exception_id,
    ))


async def _on_incident(db: AsyncSession, incident_id: uuid.UUID) -> dict[uuid.UUID, IncidentParcel]:
    rows = (await db.execute(select(IncidentParcel).where(IncidentParcel.incident_id == incident_id))).scalars().all()
    return {row.parcel_id: row for row in rows}


async def _add_parcels(db: AsyncSession, ledger: OpenLedger, request: AddParcelsUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    await guards.assert_parcels_on_trip(db, trip_id=ledger.trip.id, parcel_ids=request.parcel_ids)
    already = await _on_incident(db, ledger.incident.id)
    new = [p for p in request.parcel_ids if p not in already]
    if not new:
        raise IncidentInvalidError("Every one of those parcels is already on the incident.")
    for parcel_id in new:
        add_parcel(db, ledger, parcel_id=parcel_id, user_id=user_id, at=at)


async def _finding(db: AsyncSession, ledger: OpenLedger, request: ParcelFindingUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    named = (await _on_incident(db, ledger.incident.id)).get(request.parcel_id)
    if named is None:
        raise IncidentInvalidError("Add the parcel to the incident before recording a finding for it.")
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.PARCEL_FINDING, user_id=user_id, at=at, note=request.note, parcel_id=request.parcel_id,
        from_value=enum_text(named.latest_finding) if named.latest_finding else None, to_value=request.finding.value,
    ))
    named.latest_finding = ledger.state.parcel_findings[request.parcel_id]


def _external(db: AsyncSession, ledger: OpenLedger, request: ExternalActionUpdate, *, user_id: uuid.UUID, at: datetime) -> None:
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.EXTERNAL_ACTION, user_id=user_id, at=at, note=request.note,
        external_action=request.action, action_at=request.action_at,
    ))


async def append_update(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
    request: IncidentUpdateCreate,
) -> Incident:
    """Raises ResourceNotFoundError (404), IncidentClosedError / IncidentStateError /
    ExceptionAlreadyInIncidentError (409) and IncidentInvalidError (422)."""
    ledger = await lock_incident(db, incident_id=incident_id, organization_id=organization_id)
    ensure_open(ledger.state, incident_id=incident_id)
    at = datetime.now(UTC)
    match request:
        case NoteUpdate():
            await _note(db, ledger, request, user_id=user_id, at=at)
        case StatusUpdate():
            _status(db, ledger, request, user_id=user_id, at=at)
        case AssignUpdate():
            await _assign(db, ledger, request, user_id=user_id, at=at)
        case ConfidenceUpdate():
            _confidence(db, ledger, request, user_id=user_id, at=at)
        case LinkExceptionUpdate():
            await _link(db, ledger, request, user_id=user_id, at=at)
        case AddParcelsUpdate():
            await _add_parcels(db, ledger, request, user_id=user_id, at=at)
        case ParcelFindingUpdate():
            await _finding(db, ledger, request, user_id=user_id, at=at)
        case ExternalActionUpdate():
            _external(db, ledger, request, user_id=user_id, at=at)
    await db.flush()
    notify(db, ledger)
    return ledger.incident


async def _has_cas_declaration(db: AsyncSession, ledger: OpenLedger) -> bool:
    """A SAPS case number declared for this incident, or on its trip before incidents existed."""
    return bool((await db.execute(select(exists().where(
        IncidentDeclaration.trip_id == ledger.trip.id,
        IncidentDeclaration.saps_cas_number.is_not(None),
        or_(IncidentDeclaration.incident_id == ledger.incident.id, IncidentDeclaration.incident_id.is_(None)),
    )))).scalar())


async def close_incident(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
    request: IncidentCloseRequest,
) -> tuple[Incident, list[str]]:
    """Close with an outcome and a reason. Unresolved parcels never block it, and neither does
    a missing CAS number: both are returned or reported, not refused (Tim, 20 Oct 2026)."""
    ledger = await lock_incident(db, incident_id=incident_id, organization_id=organization_id)
    reason = check_close(ledger.state, request.reason, incident_id=incident_id)
    warnings = close_warnings(request.outcome, has_cas_declaration=await _has_cas_declaration(db, ledger))
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.CLOSED, user_id=user_id, at=datetime.now(UTC), note=reason,
        from_value=enum_text(ledger.state.status), to_value=request.outcome.value,
    ))
    await db.flush()
    notify(db, ledger)
    return ledger.incident, warnings


async def reopen_incident(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
    request: IncidentReopenRequest,
) -> Incident:
    ledger = await lock_incident(db, incident_id=incident_id, organization_id=organization_id)
    reason = check_reopen(ledger.state, request.reason, incident_id=incident_id)
    append(db, ledger, Entry(
        kind=IncidentUpdateKind.REOPENED, user_id=user_id, at=datetime.now(UTC), note=reason,
        from_value=enum_text(ledger.state.outcome) if ledger.state.outcome else None,
    ))
    await db.flush()
    notify(db, ledger)
    return ledger.incident
