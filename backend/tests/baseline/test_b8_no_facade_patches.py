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
patch through it fails this test. No patch site remains against a module still to be split:
the facades below had 13, 21, 2 and 15 (phase_service, trip_service, exception_service,
integrations.parcel_perfect) before their windows, and the evidence window's artifact_service,
corroboration_service, action_location_service, checkpoint_service and geofence_service had
5, 5, 3, 2 and 4; phase_gate, phase_plan, location_service, proximity_service and
road_check_service never had any. The fleet, handover and consignments window's driver_service,
vehicle_service, precinct_service, consignment_service, scan_service and pp_manifest_service had
12, 8, 9, 22, 4 and 3; handover_service, receiver_verification_service, pp_lookup_service,
pp_manifest and manifest_service never had any.

integrations.parcel_perfect is the odd one out: the facade IS the package, so its submodules
(`...parcel_perfect.mock`) share the facade's dotted prefix. A site is "through the facade"
only when its first segment after the facade is not a module or sub-package that exists in
the facade's directory. Facades that are plain modules have no such directory, so for them
this reduces to the plain prefix match.
"""

from functools import cache
from pathlib import Path

from tests.baseline._patch_scan import PatchSite, find_patch_sites, scan_tree

TESTS_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = TESTS_DIR.parent

FROZEN_FACADES: frozenset[str] = frozenset({
    "app.integrations.parcel_perfect",
    "app.orchestration.action_location_service",
    "app.orchestration.artifact_service",
    "app.orchestration.checkpoint_service",
    "app.orchestration.consignment_service",
    "app.orchestration.corroboration_service",
    "app.orchestration.driver_service",
    "app.orchestration.exception_service",
    "app.orchestration.geofence_service",
    "app.orchestration.handover_service",
    "app.orchestration.location_service",
    "app.orchestration.manifest_service",
    "app.orchestration.phase_gate",
    "app.orchestration.phase_plan",
    "app.orchestration.phase_service",
    "app.orchestration.pp_lookup_service",
    "app.orchestration.pp_manifest",
    "app.orchestration.pp_manifest_service",
    "app.orchestration.precinct_service",
    "app.orchestration.proximity_service",
    "app.orchestration.receiver_verification_service",
    "app.orchestration.road_check_service",
    "app.orchestration.scan_service",
    "app.orchestration.trip_service",
    "app.orchestration.vehicle_service",
})


@cache
def _owned_submodules(facade: str) -> frozenset[str]:
    """Modules and sub-packages that live in the facade's own directory.

    Read from disk so the list cannot drift from the package. Empty for a facade that is a
    plain module (no directory of that name)."""
    package_dir = BACKEND_DIR.joinpath(*facade.split("."))
    if not package_dir.is_dir():
        return frozenset()
    modules = {path.stem for path in package_dir.glob("*.py") if path.name != "__init__.py"}
    subpackages = {path.name for path in package_dir.iterdir() if (path / "__init__.py").is_file()}
    return frozenset(modules | subpackages)


def _is_through_facade(site: PatchSite, facade: str) -> bool:
    if site.target == facade:
        return True
    if not site.target.startswith(facade + "."):
        return False
    first_segment = site.target[len(facade) + 1 :].split(".")[0]
    return first_segment not in _owned_submodules(facade)


def _violations(sites: list[PatchSite], frozen: frozenset[str]) -> list[str]:
    return [
        f"{site.path}:{site.line} patches {site.target} (facade {facade})"
        for site in sites
        for facade in sorted(frozen)
        if _is_through_facade(site, facade)
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


def test_scan_catches_a_patch_dict_string_target() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        "def test_something():\n"
        '    with patch.dict("app.orchestration.phase_service.__dict__", {"x": 1}):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_patch_dict_on_an_aliased_facade_module() -> None:
    source = (
        "from unittest.mock import patch\n"
        "from app.orchestration import phase_service as ps\n"
        "\n"
        "def test_something():\n"
        '    with patch.dict(ps.__dict__, {"x": 1}):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_mocker_patch_dict_string_target() -> None:
    source = (
        "def test_something(mocker):\n"
        '    mocker.patch.dict("app.orchestration.phase_service.__dict__", {"x": 1})\n'
    )

    assert len(_flagged(source)) == 1


def test_scan_ignores_a_patch_dict_of_a_non_facade_target() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        "def test_something(mocker):\n"
        '    with patch.dict("os.environ", {"A": "1"}):\n'
        "        pass\n"
        '    mocker.patch.dict("sys.modules", {"x": None})\n'
    )

    assert _flagged(source) == []


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


# ── Facades that are also packages (integrations.parcel_perfect) ──────────────────────

PACKAGE_FACADE = frozenset({"app.integrations.parcel_perfect"})


def test_scan_catches_a_setattr_through_an_alias_of_the_facade_package() -> None:
    source = (
        "from app.integrations import parcel_perfect as pp\n"
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(pp, "get_pp_client", fake)\n'
    )

    assert len(_flagged(source, PACKAGE_FACADE)) == 1


def test_scan_catches_a_dependency_string_patched_through_the_facade_package() -> None:
    source = (
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr("app.integrations.parcel_perfect.settings.PP_API_URL", "x")\n'
    )

    assert len(_flagged(source, PACKAGE_FACADE)) == 1


def test_scan_allows_a_patch_of_a_submodule_of_the_facade_package() -> None:
    source = (
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr("app.integrations.parcel_perfect.mock.get_mock_state_store", fake)\n'
    )

    assert _flagged(source, PACKAGE_FACADE) == []


def test_scan_allows_a_setattr_on_an_aliased_submodule_of_the_facade_package() -> None:
    source = (
        "from app.integrations.parcel_perfect import mock as m\n"
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(m, "_operations_today", fake)\n'
    )

    assert _flagged(source, PACKAGE_FACADE) == []


# ── Patch targets held in a module-level string constant ─────────────────────────────

def test_scan_catches_a_constant_held_target_through_a_frozen_facade() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        '_ANCHOR = "app.orchestration.phase_service.anchor_subject"\n'
        "\n"
        "def test_something():\n"
        "    with patch(_ANCHOR):\n"
        "        pass\n"
    )

    flagged = _flagged(source)

    assert flagged == [
        "synthetic.py:6 patches app.orchestration.phase_service.anchor_subject "
        "(facade app.orchestration.phase_service)"
    ]


def test_scan_catches_an_annotated_constant_held_target_through_a_frozen_facade() -> None:
    source = (
        "from typing import Final\n"
        "\n"
        '_ANCHOR: Final[str] = "app.orchestration.phase_service.anchor_subject"\n'
        "\n"
        "def test_something(monkeypatch):\n"
        "    monkeypatch.setattr(_ANCHOR, fake)\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_allows_a_constant_held_target_in_a_submodule_of_the_facade_package() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        '_ANCHOR = "app.integrations.parcel_perfect.mock.get_mock_state_store"\n'
        "\n"
        "def test_something():\n"
        "    with patch(_ANCHOR):\n"
        "        pass\n"
    )

    assert _flagged(source, PACKAGE_FACADE) == []


def test_scan_ignores_a_constant_that_is_not_a_patch_target() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        '_FACADE_PATH = "app.orchestration.phase_service.anchor_subject"\n'
        "\n"
        "def test_something():\n"
        '    assert _FACADE_PATH.endswith("anchor_subject")\n'
        '    with patch("app.tasks.blockchain.submit"):\n'
        "        pass\n"
    )

    assert _flagged(source) == []


def test_scan_prefers_an_import_over_a_constant_of_the_same_name() -> None:
    source = (
        "from app.tasks import blockchain\n"
        "\n"
        'blockchain = "app.orchestration.phase_service.anchor_subject"\n'
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(blockchain, "submit", fake)\n'
    )

    assert _flagged(source) == []


def test_owned_submodules_are_read_from_disk_and_empty_for_plain_module_facades() -> None:
    assert {"client", "mock", "models", "port"} <= _owned_submodules("app.integrations.parcel_perfect")
    assert "__init__" not in _owned_submodules("app.integrations.parcel_perfect")
    assert _owned_submodules("app.orchestration.phase_service") == frozenset()


def test_scan_still_flags_plain_module_facades_by_prefix() -> None:
    source = (
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr("app.orchestration.phase_service.scan_service.fn", fake)\n'
    )

    assert len(_flagged(source)) == 1
