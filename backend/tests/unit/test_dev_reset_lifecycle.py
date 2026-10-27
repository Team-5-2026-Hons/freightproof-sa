"""The lifecycle reset must cover every trip-scoped table, in foreign-key order.

Both facts are derived from the models' own ForeignKeys, not from a hand-kept list:
five tables added after the script was written (handover and location-ping tables)
went unnoticed, and the reset then stopped at DELETE FROM trips. These tests make the
next new table fail here instead of on the day the reset is run.
"""

from app.db.models import Base
from scripts.dev_reset_lifecycle import (
    _CLEAR_ATTRIBUTION,
    _DELETE_ORDER,
    _REFERENCE_TABLES,
    _SEVERED_BEFORE_DELETE,
)

_DELETED_SEPARATELY = ["blockchain_receipts", "trips"]


def _references(*, severed: frozenset[tuple[str, str]] = frozenset()) -> dict[str, set[str]]:
    """table -> the tables it holds a foreign key to (self-references excluded).

    `severed` edges are (child, parent) pairs the reset nulls out before any DELETE; they
    are the only way a cycle between two tables can be deleted at all.
    """
    return {
        table.name: {
            fk.column.table.name
            for fk in table.foreign_keys
            if (table.name, fk.column.table.name) not in severed
        } - {table.name}
        for table in Base.metadata.sorted_tables
    }


def _trip_graph(references: dict[str, set[str]]) -> set[str]:
    """Every table that points at trips, directly or through another such table."""
    graph = {"trips"}
    grew = True
    while grew:
        grew = False
        for table, targets in references.items():
            if table not in graph and targets & graph:
                graph.add(table)
                grew = True
    return graph


def test_every_table_in_the_trip_graph_is_deleted_or_reference_tracked():
    handled = set(_DELETE_ORDER) | set(_DELETED_SEPARATELY) | set(_REFERENCE_TABLES)

    missing = _trip_graph(_references()) - handled

    assert missing == set(), (
        f"Add {sorted(missing)} to _DELETE_ORDER (trip-scoped) or _REFERENCE_TABLES "
        f"(reference-side audit rows) in scripts/dev_reset_lifecycle.py"
    )


def test_delete_order_removes_children_before_parents():
    references = _references(severed=_SEVERED_BEFORE_DELETE)
    sequence = [*_DELETE_ORDER, *_DELETED_SEPARATELY]
    position = {table: index for index, table in enumerate(sequence)}

    violations = [
        f"{table} must be deleted before {parent}"
        for table in sequence
        for parent in references.get(table, set())
        if parent in position and position[parent] < position[table]
    ]

    assert violations == []


def test_no_table_is_both_deleted_and_reference_tracked():
    assert set(_DELETE_ORDER) & set(_REFERENCE_TABLES) == set()


def test_reset_clears_attribution_before_deleting_phase_events():
    """evidence_artifacts.phase_event_id and the phase_events -> evidence_artifacts FKs form
    a cycle no delete order satisfies. The reset must sever it with an UPDATE, and that is
    only legitimate when the severed edge really is the cycle's nullable half."""
    full = _references()
    cycle_edges = {
        (child, parent)
        for child, parents in full.items()
        for parent in parents
        if child in full.get(parent, set())
    }
    assert ("evidence_artifacts", "phase_events") in cycle_edges
    assert _SEVERED_BEFORE_DELETE == {("evidence_artifacts", "phase_events")}

    column = Base.metadata.tables["evidence_artifacts"].c.phase_event_id
    assert column.nullable
    assert "SET phase_event_id = NULL" in _CLEAR_ATTRIBUTION
    assert "evidence_role = NULL" in _CLEAR_ATTRIBUTION

    sequence = [*_DELETE_ORDER, *_DELETED_SEPARATELY]
    position = {table: index for index, table in enumerate(sequence)}
    assert position["evidence_artifacts"] > position["phase_events"]
