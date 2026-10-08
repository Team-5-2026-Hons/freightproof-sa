"""B8 — No test may patch a module through its compatibility facade.

When a module is split, the old module becomes a facade that re-exports the moved names.
A facade preserves IMPORTS, not monkeypatching: a moved function looks names up in its
NEW module's globals, so `monkeypatch.setattr(phase_service, "_gate_and_load", fake)`
silently stops affecting the code that now lives elsewhere, and the test passes while
testing nothing (audit section 5.5). Each move commit therefore retargets patches to the
module that USES the name, and this test keeps them from creeping back.

FROZEN_FACADES started EMPTY on purpose: until a module is split it is not a facade, so
patches against it are legal and necessary. A module is added here in the SAME commit that
begins its package move, after its patches have been retargeted; from then on any new
patch through it fails this test. Patch sites against modules still to be split, at the
time of writing: exception_service 2, integrations.parcel_perfect 15. (phase_service had
13 and trip_service 21 before their windows; phase_gate and phase_plan never had any.)
"""

from pathlib import Path

from tests.baseline._patch_scan import PatchSite, find_patch_sites, scan_tree, targets_module

TESTS_DIR = Path(__file__).resolve().parents[1]

FROZEN_FACADES: frozenset[str] = frozenset({
    "app.orchestration.phase_gate",
    "app.orchestration.phase_plan",
    "app.orchestration.phase_service",
    "app.orchestration.trip_service",
})


def _violations(sites: list[PatchSite], frozen: frozenset[str]) -> list[str]:
    return [
        f"{site.path}:{site.line} patches {site.target} (facade {facade})"
        for site in sites
        for facade in sorted(frozen)
        if targets_module(site, facade)
    ]


def test_no_test_patches_a_frozen_facade() -> None:
    sites = scan_tree(TESTS_DIR)

    assert _violations(sites, FROZEN_FACADES) == []


def test_scan_actually_finds_patch_sites_in_the_real_test_tree() -> None:
    # Guards against a scanner that has gone blind (a parse change, a wrong root) and so
    # reports "no violations" for the wrong reason.
    sites = scan_tree(TESTS_DIR)

    assert len(sites) > 100


# ── Scanner self-tests: each source below is parsed, never executed ────────────────────

FACADE = frozenset({"app.orchestration.phase_service"})


def _flagged(source: str, frozen: frozenset[str] = FACADE) -> list[str]:
    return _violations(find_patch_sites(source, "synthetic.py"), frozen)


def test_scan_catches_a_multiline_monkeypatch_setattr_through_an_alias() -> None:
    source = (
        "from app.orchestration import phase_service as ps\n"
        "\n"
        "def test_something(monkeypatch):\n"
        "    monkeypatch.setattr(\n"
        "        ps,\n"
        '        "_gate_and_load",\n'
        "        fake_gate,\n"
        "    )\n"
    )

    flagged = _flagged(source)

    assert flagged == ["synthetic.py:4 patches app.orchestration.phase_service (facade app.orchestration.phase_service)"]


def test_scan_catches_a_string_target_patch() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        "def test_something():\n"
        '    with patch("app.orchestration.phase_service._dispatch_anchor"):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_patch_object_and_aliased_patch_import() -> None:
    source = (
        "from unittest.mock import patch as p\n"
        "from app.orchestration import phase_service\n"
        "\n"
        "def test_something():\n"
        '    with p.object(phase_service, "_gate_and_load"):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_dependency_patched_through_the_facade() -> None:
    source = (
        "import app.orchestration.phase_service\n"
        "\n"
        "def test_something(monkeypatch):\n"
        "    monkeypatch.setattr(\n"
        "        app.orchestration.phase_service.scan_service, 'load_consignments_at_stop', fake)\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_patch_used_as_a_decorator() -> None:
    source = (
        "from unittest import mock\n"
        "\n"
        '@mock.patch("app.orchestration.phase_service.enqueue_event")\n'
        "def test_something(patched):\n"
        "    pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_ignores_patches_of_other_modules_and_lookalike_names() -> None:
    source = (
        "from unittest.mock import patch\n"
        "from app.tasks import parcel_perfect\n"
        "\n"
        "def test_something(monkeypatch, db_session):\n"
        '    with patch("app.orchestration.phase_service_extras.thing"):\n'
        "        pass\n"
        '    monkeypatch.setattr(parcel_perfect, "x", 1)\n'
        '    monkeypatch.setattr(db_session, "execute", spy)\n'
    )

    assert _flagged(source) == []


def test_scan_reports_nothing_when_no_facade_is_frozen() -> None:
    source = (
        "from app.orchestration import phase_service\n"
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(phase_service, "_gate_and_load", fake)\n'
    )

    assert _flagged(source, frozen=frozenset()) == []
