"""B2 — Authorization per route must not change.

Snapshot of (method, path) -> access class (driver / dispatcher / admin-dispatcher /
bearer-checked-in-handler / receiver-capability-token / none) and the full list of dependency names that produced it,
including rate-limit buckets. It catches a route silently losing, gaining or swapping its
auth dependency during a move.

It does NOT prove the dependencies reject bad credentials: that is the job of the existing
integration 401/403 tests (107 assertions in 43 files, e.g. test_auth_router,
test_auth_dependencies, test_fleet_mutations_gating, test_exception_claims, test_handover_endpoints,
test_dev_triggers, test_stream). This snapshot only proves each route still points at them.

The receiver is classed by path, not by dependency: their credential is the capability
token in the URL, verified inside the handler (see _app_probe.py).
"""

from typing import Any

from tests.baseline._probe_runner import run_probe
from tests.baseline._snapshot import assert_matches_snapshot

_UNAUTHENTICATED = "none"


def _dev_additions(without_dev: dict[str, Any], with_dev: dict[str, Any]) -> dict[str, Any]:
    return {key: entry for key, entry in with_dev.items() if key not in without_dev}


def test_authorization_map_matches_committed_snapshot() -> None:
    auth_map = run_probe(False)["auth_map"]

    assert_matches_snapshot("auth_map.json", auth_map)


def test_dev_tooling_routes_authorization_matches_committed_snapshot() -> None:
    without_dev = run_probe(False)["auth_map"]
    with_dev = run_probe(True)["auth_map"]

    additions = _dev_additions(without_dev, with_dev)

    for key, entry in without_dev.items():
        assert with_dev[key] == entry, f"{key} authorization differs with dev tooling on"
    assert additions, "expected dev tooling to register at least one route"
    assert_matches_snapshot("auth_map.dev_additions.json", additions)
