"""The hijacking response checklist, derived from what was recorded — never a stored checkbox.

Each step is "done" because an entry says so (an external action on the ledger, a declaration,
an issued pack), so the checklist cannot claim a step nobody recorded. FreightProof records each
response; it never performs one (docs/scope-boundaries.md §0). Pure: facts in, steps out.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from app.db.models.enums import IncidentExternalAction, TripStatus
from app.schemas.audit_pack import IncidentDeclarationRecord
from app.schemas.incidents import ResponseStep

_FINISHED_TRIP = (TripStatus.CLOSED, TripStatus.CANCELLED)


@dataclass(frozen=True)
class GuideFacts:
    trip_stopped_at: datetime | None
    trip_status: TripStatus
    # (action, when it happened — action_at as told, else when it was recorded)
    actions: Sequence[tuple[IncidentExternalAction, datetime]]
    declarations: Sequence[IncidentDeclarationRecord]
    pack_issued_at: datetime | None


def _earliest(*times: datetime | None) -> datetime | None:
    known = [t for t in times if t is not None]
    return min(known, default=None)


def _acted(facts: GuideFacts, action: IncidentExternalAction) -> datetime | None:
    return _earliest(*(at for kind, at in facts.actions if kind == action))


def _declared(facts: GuideFacts, field: str) -> datetime | None:
    return _earliest(*(getattr(d, field) for d in facts.declarations))


def _step(key: str, done_at: datetime | None, detail: str | None = None) -> ResponseStep:
    return ResponseStep(key=key, state="done" if done_at else "todo", done_at=done_at, detail=detail)


def _trip_stopped(facts: GuideFacts) -> ResponseStep:
    if facts.trip_stopped_at is not None:
        return _step("trip_stopped", facts.trip_stopped_at)
    if facts.trip_status in _FINISHED_TRIP:
        return ResponseStep(key="trip_stopped", state="not_applicable", detail="The trip had already ended.")
    return _step("trip_stopped", None)


def _saps(facts: GuideFacts) -> ResponseStep:
    with_case = [d for d in facts.declarations if d.saps_cas_number]
    if with_case:
        first = min(with_case, key=lambda d: d.declared_at)
        where = f" at {first.saps_station}" if first.saps_station else ""
        return ResponseStep(
            key="saps_reported", state="done", done_at=first.reported_to_saps_at or first.declared_at,
            detail=f"{first.saps_cas_number}{where}",
        )
    reported_at = _earliest(_acted(facts, IncidentExternalAction.SAPS_REPORTED), _declared(facts, "reported_to_saps_at"))
    if reported_at is not None:
        # Reported, but the case number the claim form needs is not on record yet.
        return ResponseStep(key="saps_reported", state="in_progress", done_at=reported_at, detail="No CAS number recorded yet.")
    return _step("saps_reported", None)


def _insurer(facts: GuideFacts) -> ResponseStep:
    references = [d.insurer_claim_reference for d in facts.declarations if d.insurer_claim_reference]
    at = _earliest(_acted(facts, IncidentExternalAction.INSURER_NOTIFIED), _declared(facts, "insurer_notified_at"))
    return _step("insurer_notified", at, f"Claim {references[0]}" if references else None)


def build_response_guide(facts: GuideFacts) -> list[ResponseStep]:
    """The steps in the order a dispatcher takes them after a hijacking."""
    return [
        _trip_stopped(facts),
        _step("tracking_company_alerted", _earliest(
            _acted(facts, IncidentExternalAction.TRACKING_COMPANY_ALERTED), _declared(facts, "tracking_company_notified_at"),
        )),
        _saps(facts),
        _insurer(facts),
        _step("client_notified", _earliest(
            _acted(facts, IncidentExternalAction.CLIENT_NOTIFIED), _declared(facts, "client_notified_at"),
        )),
        _step("driver_welfare_check", _acted(facts, IncidentExternalAction.DRIVER_WELFARE_CHECK)),
        _step("audit_pack_issued", facts.pack_issued_at),
    ]
