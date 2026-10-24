"""Trip facts the assistant works out in code so the model never subtracts (coverage audit item 5)."""

from datetime import UTC, datetime, timedelta

from app.orchestration.assistant.tools_trips import delay_minutes, delay_text

PLANNED = datetime(2026, 10, 22, 6, tzinfo=UTC)


def test_delay_text_reads_late_early_and_on_time() -> None:
    assert delay_text(delay_minutes(PLANNED, PLANNED + timedelta(minutes=95))) == "1 h 35 min late"
    assert delay_text(delay_minutes(PLANNED, PLANNED - timedelta(minutes=10))) == "10 min early"
    assert delay_text(delay_minutes(PLANNED, PLANNED)) == "on time"


def test_delay_needs_both_times() -> None:
    assert delay_text(delay_minutes(None, PLANNED)) is None
    assert delay_text(delay_minutes(PLANNED, None)) is None
