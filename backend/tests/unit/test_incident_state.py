"""Unit tests for orchestration/incidents/state.py — the pure incident lifecycle.

No DB, no HTTP: the ledger replay, the transition rules, the closing rules and the
closing warnings, all from plain values.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.exceptions import IncidentClosedError, IncidentInvalidError, IncidentStateError
from app.db.models.enums import (
    IncidentConfidence,
    IncidentOutcome,
    IncidentStatus,
    IncidentUpdateKind,
    ParcelFinding,
)
from app.orchestration.incidents.state import (
    THEFT_REPORTED_WITHOUT_CAS,
    UpdateFact,
    apply,
    check_close,
    check_reopen,
    check_status_change,
    close_warnings,
    ensure_open,
    replay,
)


def _opened(confidence: IncidentConfidence = IncidentConfidence.REPORTED) -> UpdateFact:
    return UpdateFact(kind=IncidentUpdateKind.OPENED, to_value=confidence.value)


def _at(minutes: int = 0) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes)


def test_replay_opened_only_is_open():
    state = replay([_opened(IncidentConfidence.SUSPECTED)])

    assert state.status == IncidentStatus.OPEN
    assert state.confidence == IncidentConfidence.SUSPECTED
    assert state.assigned_to is None
    assert state.outcome is None
    assert state.closed_at is None


def test_replay_without_opened_first_raises():
    with pytest.raises(IncidentInvalidError):
        replay([UpdateFact(kind=IncidentUpdateKind.NOTE, note="orphan")])


def test_replay_status_then_close_sets_outcome():
    closed_at = _at(30)

    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.STATUS_CHANGED, to_value=IncidentStatus.INVESTIGATING.value),
        UpdateFact(
            kind=IncidentUpdateKind.CLOSED, to_value=IncidentOutcome.SHORTAGE_CONFIRMED.value,
            note="Two parcels never left the depot", at=closed_at,
        ),
    ])

    assert state.status == IncidentStatus.CLOSED
    assert state.outcome == IncidentOutcome.SHORTAGE_CONFIRMED
    assert state.closure_reason == "Two parcels never left the depot"
    assert state.closed_at == closed_at


def test_replay_assigned_then_unassigned():
    owner = uuid.uuid4()

    assigned = replay([_opened(), UpdateFact(kind=IncidentUpdateKind.ASSIGNED, to_value=str(owner))])
    cleared = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.ASSIGNED, to_value=str(owner)),
        UpdateFact(kind=IncidentUpdateKind.ASSIGNED, to_value=None),
    ])

    assert assigned.assigned_to == owner
    assert cleared.assigned_to is None


def test_replay_confidence_change():
    state = replay([
        _opened(IncidentConfidence.REPORTED),
        UpdateFact(kind=IncidentUpdateKind.CONFIDENCE_CHANGED, to_value=IncidentConfidence.CORROBORATED.value),
    ])

    assert state.confidence == IncidentConfidence.CORROBORATED


def test_replay_parcel_finding_latest_wins():
    parcel = uuid.uuid4()

    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.PARCEL_FINDING, parcel_id=parcel, to_value=ParcelFinding.CONFIRMED_MISSING.value),
        UpdateFact(kind=IncidentUpdateKind.PARCEL_FINDING, parcel_id=parcel, to_value=ParcelFinding.LOCATED.value),
    ])

    assert state.parcel_findings == {parcel: ParcelFinding.LOCATED}


def test_replay_reopened_clears_outcome():
    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.CLOSED, to_value=IncidentOutcome.INCONCLUSIVE.value, note="No leads", at=_at()),
        UpdateFact(kind=IncidentUpdateKind.REOPENED, note="Client found CCTV footage"),
    ])

    assert state.status == IncidentStatus.INVESTIGATING
    assert state.outcome is None
    assert state.closed_at is None
    assert state.closure_reason is None


def test_replay_status_change_without_value_raises():
    with pytest.raises(IncidentInvalidError):
        replay([_opened(), UpdateFact(kind=IncidentUpdateKind.STATUS_CHANGED)])


def test_replay_note_and_links_change_nothing():
    base = replay([_opened()])

    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.NOTE, note="Called the client"),
        UpdateFact(kind=IncidentUpdateKind.EXCEPTION_LINKED, exception_id=uuid.uuid4()),
        UpdateFact(kind=IncidentUpdateKind.PARCEL_ADDED, parcel_id=uuid.uuid4()),
        UpdateFact(kind=IncidentUpdateKind.EXTERNAL_ACTION, note="SAPS informed"),
        UpdateFact(kind=IncidentUpdateKind.TRIP_STOPPED),
    ])

    assert state == base


def test_apply_is_replay_step_by_step():
    facts = [
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.STATUS_CHANGED, to_value=IncidentStatus.INVESTIGATING.value),
        UpdateFact(kind=IncidentUpdateKind.CONFIDENCE_CHANGED, to_value=IncidentConfidence.CORROBORATED.value),
    ]

    stepped = apply(apply(replay(facts[:1]), facts[1]), facts[2])

    assert stepped == replay(facts)


def test_check_status_change_open_to_investigating_allowed():
    check_status_change(IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, incident_id=uuid.uuid4())


@pytest.mark.parametrize(("current", "target"), [
    (IncidentStatus.INVESTIGATING, IncidentStatus.OPEN),
    (IncidentStatus.OPEN, IncidentStatus.OPEN),
    (IncidentStatus.OPEN, IncidentStatus.CLOSED),
    (IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED),
])
def test_check_status_change_rejected(current, target):
    with pytest.raises(IncidentStateError):
        check_status_change(current, target, incident_id=uuid.uuid4())


def test_check_status_change_closed_raises_closed_error():
    with pytest.raises(IncidentClosedError):
        check_status_change(IncidentStatus.CLOSED, IncidentStatus.INVESTIGATING, incident_id=uuid.uuid4())


def test_ensure_open_closed_raises():
    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.CLOSED, to_value=IncidentOutcome.INCONCLUSIVE.value, note="x", at=_at()),
    ])

    with pytest.raises(IncidentClosedError):
        ensure_open(state, incident_id=uuid.uuid4())


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_check_close_without_reason_raises(reason):
    with pytest.raises(IncidentInvalidError):
        check_close(replay([_opened()]), reason, incident_id=uuid.uuid4())


def test_check_close_inconclusive_allowed_with_reason():
    check_close(replay([_opened()]), "No evidence either way after client follow-up", incident_id=uuid.uuid4())


def test_check_close_twice_raises():
    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.CLOSED, to_value=IncidentOutcome.INCONCLUSIVE.value, note="x", at=_at()),
    ])

    with pytest.raises(IncidentClosedError):
        check_close(state, "again", incident_id=uuid.uuid4())


def test_check_reopen_open_incident_raises():
    with pytest.raises(IncidentStateError):
        check_reopen(replay([_opened()]), "why", incident_id=uuid.uuid4())


def test_check_reopen_without_reason_raises():
    state = replay([
        _opened(),
        UpdateFact(kind=IncidentUpdateKind.CLOSED, to_value=IncidentOutcome.INCONCLUSIVE.value, note="x", at=_at()),
    ])

    with pytest.raises(IncidentInvalidError):
        check_reopen(state, " ", incident_id=uuid.uuid4())


def test_close_warnings_theft_reported_without_cas_warns():
    warnings = close_warnings(IncidentOutcome.THEFT_REPORTED, has_cas_declaration=False)

    assert warnings == [THEFT_REPORTED_WITHOUT_CAS]


def test_close_warnings_theft_reported_with_cas_empty():
    assert close_warnings(IncidentOutcome.THEFT_REPORTED, has_cas_declaration=True) == []


def test_close_warnings_other_outcomes_never_need_cas():
    assert close_warnings(IncidentOutcome.SHORTAGE_CONFIRMED, has_cas_declaration=False) == []
