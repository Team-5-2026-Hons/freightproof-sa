"""The one way anything is written to an incident: append a ledger entry, then copy the state
that entry produces onto the Incident row's cache columns.

append() is the only writer of those caches, and it derives them with state.apply(), so the
caches always equal state.replay() of the ledger. Every entry's created_at is set here from the
caller's single `now`, not left to the server default: Postgres now() is the transaction's start
time, and a CLOSED entry's timestamp is the incident's closed_at, which the replay must reproduce.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event
from app.db.models.enums import IncidentExternalAction, IncidentStatus, IncidentUpdateKind
from app.db.models.incidents import Incident, IncidentUpdate
from app.db.models.trips import Trip
from app.orchestration.incidents.state import IncidentState, UpdateFact, apply, replay


@dataclass
class OpenLedger:
    """An incident held FOR UPDATE, with the state its ledger adds up to and the next sequence."""

    incident: Incident
    trip: Trip
    state: IncidentState
    next_sequence: int


def to_fact(row: IncidentUpdate) -> UpdateFact:
    return UpdateFact(
        kind=IncidentUpdateKind(row.kind), to_value=row.to_value, note=row.note,
        parcel_id=row.parcel_id, exception_id=row.exception_id, at=row.created_at,
    )


def write_cache(incident: Incident, state: IncidentState) -> None:
    incident.status = state.status
    incident.confidence = state.confidence
    incident.assigned_to_user_id = state.assigned_to
    incident.outcome = state.outcome
    incident.closed_at = state.closed_at
    incident.closure_reason = state.closure_reason


async def lock_incident(db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID) -> OpenLedger:
    """Load an org-scoped incident with a row lock, and replay its ledger.

    The lock serialises every write to one incident, so two dispatchers' entries get distinct
    sequence numbers and each one's checks see the other's result. The state is replayed rather
    than read from the caches, so a write path decides on the ledger, which is the truth.
    """
    row = (await db.execute(
        select(Incident, Trip)
        .join(Trip, Trip.id == Incident.trip_id)
        .where(Incident.id == incident_id, Trip.operator_organization_id == organization_id)
        .with_for_update(of=Incident)
        .execution_options(populate_existing=True)
    )).tuples().one_or_none()
    if row is None:
        raise ResourceNotFoundError("Incident", str(incident_id))
    incident, trip = row
    entries = (await db.execute(
        select(IncidentUpdate).where(IncidentUpdate.incident_id == incident.id).order_by(IncidentUpdate.sequence)
    )).scalars().all()
    return OpenLedger(
        incident=incident, trip=trip, state=replay([to_fact(e) for e in entries]),
        next_sequence=len(entries) + 1,
    )


@dataclass(frozen=True)
class Entry:
    """One ledger entry to append: its kind, who and when, and whatever it carries or cites."""

    kind: IncidentUpdateKind
    user_id: uuid.UUID
    at: datetime
    note: str | None = None
    from_value: str | None = None
    to_value: str | None = None
    parcel_id: uuid.UUID | None = None
    exception_id: uuid.UUID | None = None
    phase_event_id: uuid.UUID | None = None
    artifact_id: uuid.UUID | None = None
    external_action: IncidentExternalAction | None = None
    action_at: datetime | None = None


def _row(incident_id: uuid.UUID, sequence: int, entry: Entry) -> IncidentUpdate:
    return IncidentUpdate(
        id=uuid.uuid4(), incident_id=incident_id, sequence=sequence, kind=entry.kind,
        note=entry.note, from_value=entry.from_value, to_value=entry.to_value, parcel_id=entry.parcel_id,
        exception_id=entry.exception_id, phase_event_id=entry.phase_event_id, artifact_id=entry.artifact_id,
        external_action=entry.external_action, action_at=entry.action_at, recorded_by_user_id=entry.user_id,
        created_at=entry.at, updated_at=entry.at,
    )


def append(db: AsyncSession, ledger: OpenLedger, entry: Entry) -> IncidentUpdate:
    row = _row(ledger.incident.id, ledger.next_sequence, entry)
    db.add(row)
    ledger.next_sequence += 1
    ledger.state = apply(ledger.state, to_fact(row))
    write_cache(ledger.incident, ledger.state)
    return row


def start(db: AsyncSession, *, incident: Incident, trip: Trip, opened: Entry) -> OpenLedger:
    """Write a new incident's OPENED entry, the ledger's first, which carries its confidence."""
    row = _row(incident.id, 1, opened)
    db.add(row)
    ledger = OpenLedger(incident=incident, trip=trip, state=replay([to_fact(row)]), next_sequence=2)
    write_cache(incident, ledger.state)
    return ledger


def notify(db: AsyncSession, ledger: OpenLedger) -> None:
    """Queue the dispatcher refetch for after commit. Ids only, like every realtime event."""
    enqueue_event(db, ledger.trip.operator_organization_id, TripEvent(id=ledger.trip.id, kind=RealtimeKind.INCIDENT_CHANGED))


def is_closed(ledger: OpenLedger) -> bool:
    return ledger.state.status == IncidentStatus.CLOSED
