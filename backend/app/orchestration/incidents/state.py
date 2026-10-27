"""The incident lifecycle as pure functions: no DB, no clock, no I/O.

The ledger (incident_updates) is the truth; IncidentState is what it adds up to. Every write
path in orchestration.incidents computes the new state with apply() and copies it onto the
Incident row's cache columns, so the caches can only ever hold what replay() of the ledger
would give — the same rule the phase position follows.

Lifecycle: OPEN → INVESTIGATING → CLOSED, with CLOSED → INVESTIGATING only by REOPENED.
Closing needs an outcome and a reason; it never needs the cargo to have been found.
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from types import MappingProxyType

from app.core.exceptions import IncidentClosedError, IncidentInvalidError, IncidentStateError
from app.db.models.enums import (
    IncidentConfidence,
    IncidentOutcome,
    IncidentStatus,
    IncidentUpdateKind,
    ParcelFinding,
)

_MANUAL_STATUS_MOVES: frozenset[tuple[IncidentStatus, IncidentStatus]] = frozenset({
    (IncidentStatus.OPEN, IncidentStatus.INVESTIGATING),
})

THEFT_REPORTED_WITHOUT_CAS = "theft_reported_without_cas"


@dataclass(frozen=True)
class UpdateFact:
    """The parts of one ledger entry that can move the state, plus what it cites."""

    kind: IncidentUpdateKind
    to_value: str | None = None
    note: str | None = None
    parcel_id: uuid.UUID | None = None
    exception_id: uuid.UUID | None = None
    at: datetime | None = None


@dataclass(frozen=True)
class IncidentState:
    status: IncidentStatus
    confidence: IncidentConfidence
    assigned_to: uuid.UUID | None = None
    outcome: IncidentOutcome | None = None
    closed_at: datetime | None = None
    closure_reason: str | None = None
    parcel_findings: Mapping[uuid.UUID, ParcelFinding] = field(default_factory=lambda: MappingProxyType({}))


def _opened(fact: UpdateFact) -> IncidentState:
    if fact.kind != IncidentUpdateKind.OPENED or fact.to_value is None:
        raise IncidentInvalidError("An incident's ledger must start with an OPENED entry carrying its confidence.")
    return IncidentState(status=IncidentStatus.OPEN, confidence=IncidentConfidence(fact.to_value))


def _to_value(fact: UpdateFact) -> str:
    if fact.to_value is None:
        raise IncidentInvalidError(f"A '{fact.kind.value}' entry must carry the value it sets.")
    return fact.to_value


def apply(state: IncidentState, fact: UpdateFact) -> IncidentState:
    """The state after one more ledger entry. Entries that only cite evidence (notes, links,
    external actions, documents, the trip stop) leave the state as it was."""
    match fact.kind:
        case IncidentUpdateKind.STATUS_CHANGED:
            return replace(state, status=IncidentStatus(_to_value(fact)))
        case IncidentUpdateKind.ASSIGNED:
            return replace(state, assigned_to=uuid.UUID(fact.to_value) if fact.to_value else None)
        case IncidentUpdateKind.CONFIDENCE_CHANGED:
            return replace(state, confidence=IncidentConfidence(_to_value(fact)))
        case IncidentUpdateKind.PARCEL_FINDING:
            if fact.parcel_id is None:
                raise IncidentInvalidError("A parcel finding must name its parcel.")
            findings = {**state.parcel_findings, fact.parcel_id: ParcelFinding(_to_value(fact))}
            return replace(state, parcel_findings=MappingProxyType(findings))
        case IncidentUpdateKind.CLOSED:
            return replace(
                state, status=IncidentStatus.CLOSED, outcome=IncidentOutcome(_to_value(fact)),
                closed_at=fact.at, closure_reason=fact.note,
            )
        case IncidentUpdateKind.REOPENED:
            return replace(state, status=IncidentStatus.INVESTIGATING, outcome=None, closed_at=None, closure_reason=None)
        case IncidentUpdateKind.OPENED:
            raise IncidentInvalidError("An incident is opened once.")
        case _:
            return state


def replay(facts: Sequence[UpdateFact]) -> IncidentState:
    """What the whole ledger, in sequence order, adds up to."""
    if not facts:
        raise IncidentInvalidError("An incident's ledger cannot be empty.")
    state = _opened(facts[0])
    for fact in facts[1:]:
        state = apply(state, fact)
    return state


def ensure_open(state: IncidentState, *, incident_id: uuid.UUID) -> None:
    """Every follow-up except reopening needs a live investigation."""
    if state.status == IncidentStatus.CLOSED:
        raise IncidentClosedError(incident_id)


def check_status_change(current: IncidentStatus, target: IncidentStatus, *, incident_id: uuid.UUID) -> None:
    if current == IncidentStatus.CLOSED:
        raise IncidentClosedError(incident_id)
    if (current, target) not in _MANUAL_STATUS_MOVES:
        raise IncidentStateError(
            f"An incident cannot move from '{current.value}' to '{target.value}'. "
            "Close and reopen are their own actions, each with a reason."
        )


def _require_reason(reason: str | None, action: str) -> str:
    if reason is None or not reason.strip():
        raise IncidentInvalidError(f"A reason is required to {action} an incident.")
    return reason.strip()


def check_close(state: IncidentState, reason: str | None, *, incident_id: uuid.UUID) -> str:
    """Returns the cleaned reason. Unresolved parcels do not block closing: "what remains
    unresolved" is a legitimate end state, and the audit pack says so."""
    ensure_open(state, incident_id=incident_id)
    return _require_reason(reason, "close")


def check_reopen(state: IncidentState, reason: str | None, *, incident_id: uuid.UUID) -> str:
    if state.status != IncidentStatus.CLOSED:
        raise IncidentStateError(f"Incident '{incident_id}' is not closed, so it cannot be reopened.")
    return _require_reason(reason, "reopen")


def close_warnings(outcome: IncidentOutcome, *, has_cas_declaration: bool) -> list[str]:
    """Things worth telling the dispatcher as they close. Never a refusal."""
    if outcome == IncidentOutcome.THEFT_REPORTED and not has_cas_declaration:
        return [THEFT_REPORTED_WITHOUT_CAS]
    return []
