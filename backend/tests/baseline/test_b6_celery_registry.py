"""B6 — Celery task names must not change.

Task names are explicit strings (name="tasks.blockchain.anchor_phase_event", ...), and
that string is the contract: it is what is already sitting in the Redis queue and in the
beat schedule. Moving the function that carries a name (audit phase 4 moves the code
behind tasks.blockchain) must leave the string alone, or in-flight and scheduled work is
addressed to a task no worker has.

tests/unit/test_blockchain_task_registration.py pins two of these names individually.
This pins the whole set, so a task cannot be added, dropped or renamed unnoticed.

Anchoring recovery itself (recover_phase_anchor picking up a PENDING row older than
due_before) is already pinned by tests/unit/test_phase_anchor_payload.py::
test_recovery_restores_lost_dispatch_without_changing_original_hash and
tests/integration/test_every_phase_anchoring.py::
test_recover_phase_anchor_picks_up_an_overdue_override_and_anchors_it, so it is not repeated.
"""

from app.tasks import celery

# Celery registers its own housekeeping tasks (celery.chord, celery.backend_cleanup, ...).
# They are the library's, not ours, and their set changes with the Celery version.
_CELERY_BUILTIN_PREFIX = "celery."

EXPECTED_APPLICATION_TASKS = frozenset({
    "tasks.blockchain.anchor_phase_event",
    "tasks.blockchain.recover_phase_anchors",
    "tasks.pp.sync_active_consignments",
    "tasks.verification.sweep_abandoned",
})

EXPECTED_BEAT_ENTRIES = frozenset({
    "pp-sync-active-consignments",
    "idvs-sweep-abandoned-verifications",
    "recover-phase-anchors",
})


def test_registered_application_task_names_are_exactly_the_expected_set() -> None:
    registered = {name for name in celery.tasks if not name.startswith(_CELERY_BUILTIN_PREFIX)}

    assert registered == EXPECTED_APPLICATION_TASKS


def test_beat_schedule_entries_are_exactly_the_expected_set() -> None:
    entries = set(celery.conf.beat_schedule)

    assert entries == EXPECTED_BEAT_ENTRIES


def test_every_beat_entry_points_at_a_registered_task() -> None:
    targets = {entry["task"] for entry in celery.conf.beat_schedule.values()}

    assert targets <= set(celery.tasks)
