"""Only an ordered, resolved ledger prefix can justify a phase attribution."""

import uuid
from datetime import UTC, datetime, timedelta

from app.db.models.phases import PhaseEvent
from app.orchestration.substitutions.reads import _recorded_phase_context


def test_phase_context_refuses_a_resolved_phase_after_an_unresolved_gap() -> None:
    started = datetime.now(UTC)
    phases = [
        PhaseEvent(id=uuid.uuid4(), phase_type="activation", status="completed", completed_at=started),
        PhaseEvent(id=uuid.uuid4(), phase_type="loading", status="pending"),
        PhaseEvent(id=uuid.uuid4(), phase_type="departure", status="completed", completed_at=started + timedelta(hours=2)),
        PhaseEvent(id=uuid.uuid4(), phase_type="arrival", status="pending"),
    ]

    assert _recorded_phase_context(phases, started + timedelta(hours=3)) is None


def test_phase_context_uses_the_next_phase_after_a_resolved_prefix() -> None:
    started = datetime.now(UTC)
    loading = PhaseEvent(id=uuid.uuid4(), phase_type="loading", status="in_progress")
    phases = [PhaseEvent(id=uuid.uuid4(), phase_type="activation", status="completed", completed_at=started), loading]

    context = _recorded_phase_context(phases, started + timedelta(minutes=1))

    assert context is not None and context.phase_event_id == loading.id
    assert _recorded_phase_context(phases, started) is None
