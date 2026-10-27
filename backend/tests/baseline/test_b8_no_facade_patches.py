"""B8 — Retired module paths stay retired, and no test patches a module through a facade.

Two guards live here because they protect the same thing: a moved module's old path must not
quietly come back into use (audit sections 5.5 and 6.1).

RETIRED_MODULES. The 31 flat `app.orchestration.*_service` (and sibling) modules were
compatibility wrappers over the packages that now hold the code; they were deleted once the
last in-repo consumer had moved (audit section 6.1 removal record). Two tests keep them gone:
no retired path can be imported, and no .py file under app/, tests/ or scripts/ names one as an
import or a string. A wrapper has to be re-created on purpose, in a commit that edits this
list; it cannot reappear because a stale branch merged an import of it.

FROZEN_FACADES. A facade preserves IMPORTS, not monkeypatching: a moved function looks names
up in its NEW module's globals, so `monkeypatch.setattr(facade, "_gate_and_load", fake)`
silently stops affecting the code that now lives elsewhere, and the test passes while testing
nothing (audit section 5.5). The one facade left is the package `app.integrations.parcel_perfect`
(its `__init__` re-exports the submodules, section 6.1 keeps it); patching through it is banned.
Patch the module that USES the name. The wrappers that used to be frozen here are retired, so
they are guarded by RETIRED_MODULES instead.

integrations.parcel_perfect is the odd one out: the facade IS the package, so its submodules
(`...parcel_perfect.mock`) share the facade's dotted prefix. A site is "through the facade"
only when its first segment after the facade is not a module or sub-package that exists in
the facade's directory. A facade that is a plain module has no such directory, so for it this
reduces to the plain prefix match; the scanner self-tests below use a placeholder module
(`app.example.legacy_service`) for that case, because they must not name a retired path.
"""

import ast
import importlib.util
import re
from functools import cache
from pathlib import Path

from tests.baseline._patch_scan import PatchSite, find_patch_sites, scan_tree

TESTS_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = TESTS_DIR.parent

FROZEN_FACADES: frozenset[str] = frozenset({
    "app.integrations.parcel_perfect",
})

RETIRED_MODULES: tuple[str, ...] = (
    "app.orchestration.action_location_service",
    "app.orchestration.analytics_service",
    "app.orchestration.artifact_service",
    "app.orchestration.checkpoint_service",
    "app.orchestration.consignment_service",
    "app.orchestration.corroboration_service",
    "app.orchestration.driver_service",
    "app.orchestration.exception_service",
    "app.orchestration.fleet_analytics_service",
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
    "app.orchestration.receipt_service",
    "app.orchestration.receiver_verification_service",
    "app.orchestration.resource_service",
    "app.orchestration.review_identity",
    "app.orchestration.review_policy",
    "app.orchestration.road_check_service",
    "app.orchestration.scan_service",
    "app.orchestration.trip_service",
    "app.orchestration.vehicle_service",
    "app.orchestration.verification_service",
)

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
    sites = scan_tree(TESTS_DIR)

    assert len(sites) > 100


FACADE = frozenset({"app.example.legacy_service"})


def _flagged(source: str, frozen: frozenset[str] = FACADE) -> list[str]:
    return _violations(find_patch_sites(source, "synthetic.py"), frozen)


def test_scan_catches_a_multiline_monkeypatch_setattr_through_an_alias() -> None:
    source = (
        "from app.example import legacy_service as ps\n"
        "\n"
        "def test_something(monkeypatch):\n"
        "    monkeypatch.setattr(\n"
        "        ps,\n"
        '        "_gate_and_load",\n'
        "        fake_gate,\n"
        "    )\n"
    )

    flagged = _flagged(source)

    assert flagged == ["synthetic.py:4 patches app.example.legacy_service (facade app.example.legacy_service)"]


def test_scan_catches_a_string_target_patch() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        "def test_something():\n"
        '    with patch("app.example.legacy_service._dispatch_anchor"):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_patch_object_and_aliased_patch_import() -> None:
    source = (
        "from unittest.mock import patch as p\n"
        "from app.example import legacy_service\n"
        "\n"
        "def test_something():\n"
        '    with p.object(legacy_service, "_gate_and_load"):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_patch_dict_string_target() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        "def test_something():\n"
        '    with patch.dict("app.example.legacy_service.__dict__", {"x": 1}):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_patch_dict_on_an_aliased_facade_module() -> None:
    source = (
        "from unittest.mock import patch\n"
        "from app.example import legacy_service as ps\n"
        "\n"
        "def test_something():\n"
        '    with patch.dict(ps.__dict__, {"x": 1}):\n'
        "        pass\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_mocker_patch_dict_string_target() -> None:
    source = (
        "def test_something(mocker):\n"
        '    mocker.patch.dict("app.example.legacy_service.__dict__", {"x": 1})\n'
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
        "import app.example.legacy_service\n"
        "\n"
        "def test_something(monkeypatch):\n"
        "    monkeypatch.setattr(\n"
        "        app.example.legacy_service.scan_service, 'load_consignments_at_stop', fake)\n"
    )

    assert len(_flagged(source)) == 1


def test_scan_catches_a_patch_used_as_a_decorator() -> None:
    source = (
        "from unittest import mock\n"
        "\n"
        '@mock.patch("app.example.legacy_service.enqueue_event")\n'
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
        '    with patch("app.example.legacy_service_extras.thing"):\n'
        "        pass\n"
        '    monkeypatch.setattr(parcel_perfect, "x", 1)\n'
        '    monkeypatch.setattr(db_session, "execute", spy)\n'
    )

    assert _flagged(source) == []


def test_scan_reports_nothing_when_no_facade_is_frozen() -> None:
    source = (
        "from app.example import legacy_service\n"
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(legacy_service, "_gate_and_load", fake)\n'
    )

    assert _flagged(source, frozen=frozenset()) == []


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


def test_scan_catches_a_constant_held_target_through_a_frozen_facade() -> None:
    source = (
        "from unittest.mock import patch\n"
        "\n"
        '_ANCHOR = "app.example.legacy_service.anchor_subject"\n'
        "\n"
        "def test_something():\n"
        "    with patch(_ANCHOR):\n"
        "        pass\n"
    )

    flagged = _flagged(source)

    assert flagged == [
        "synthetic.py:6 patches app.example.legacy_service.anchor_subject "
        "(facade app.example.legacy_service)"
    ]


def test_scan_catches_an_annotated_constant_held_target_through_a_frozen_facade() -> None:
    source = (
        "from typing import Final\n"
        "\n"
        '_ANCHOR: Final[str] = "app.example.legacy_service.anchor_subject"\n'
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
        '_FACADE_PATH = "app.example.legacy_service.anchor_subject"\n'
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
        'blockchain = "app.example.legacy_service.anchor_subject"\n'
        "\n"
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr(blockchain, "submit", fake)\n'
    )

    assert _flagged(source) == []


def test_owned_submodules_are_read_from_disk_and_empty_for_plain_module_facades() -> None:
    assert {"client", "mock", "models", "port"} <= _owned_submodules("app.integrations.parcel_perfect")
    assert "__init__" not in _owned_submodules("app.integrations.parcel_perfect")
    assert _owned_submodules("app.example.legacy_service") == frozenset()


def test_scan_still_flags_plain_module_facades_by_prefix() -> None:
    source = (
        "def test_something(monkeypatch):\n"
        '    monkeypatch.setattr("app.example.legacy_service.scan_service.fn", fake)\n'
    )

    assert len(_flagged(source)) == 1


SCANNED_DIRS: tuple[str, ...] = ("app", "tests", "scripts")
ORCHESTRATION_DIR = BACKEND_DIR / "app" / "orchestration"
THIS_FILE = Path(__file__).resolve()
_RETIRED_STEMS: tuple[str, ...] = tuple(path.rsplit(".", 1)[1] for path in RETIRED_MODULES)
_RETIRED_PATH = re.compile(
    r"app[./]orchestration[./](" + "|".join(_RETIRED_STEMS) + r")(?![A-Za-z0-9_])"
)


def _is_retired(module: str) -> bool:
    return any(module == retired or module.startswith(retired + ".") for retired in RETIRED_MODULES)


def find_retired_references(source: str, filename: str, *, in_orchestration_root: bool = False) -> list[str]:
    """Every import or string in `source` that names a retired module, as 'file:line what'."""
    hits: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level == 0 and _is_retired(module):
                hits.append(f"{filename}:{node.lineno} imports {module}")
            elif node.level == 0 and module == "app.orchestration":
                hits.extend(
                    f"{filename}:{node.lineno} imports {module}.{alias.name}"
                    for alias in node.names if alias.name in _RETIRED_STEMS
                )
            elif node.level == 1 and in_orchestration_root:
                names = [module] if module else [alias.name for alias in node.names]
                hits.extend(
                    f"{filename}:{node.lineno} relatively imports {name}"
                    for name in names if name.split(".")[0] in _RETIRED_STEMS
                )
        elif isinstance(node, ast.Import):
            hits.extend(
                f"{filename}:{node.lineno} imports {alias.name}"
                for alias in node.names if _is_retired(alias.name)
            )
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            match = _RETIRED_PATH.search(node.value)
            if match:
                hits.append(f"{filename}:{node.lineno} has the string {match.group(0)}")
    return hits


@cache
def _scanned_files() -> tuple[Path, ...]:
    return tuple(
        path for directory in SCANNED_DIRS
        for path in sorted((BACKEND_DIR / directory).rglob("*.py"))
        if path.resolve() != THIS_FILE
    )


def test_no_retired_module_can_be_imported() -> None:
    importable = [name for name in RETIRED_MODULES if importlib.util.find_spec(name) is not None]
    leftover_files = [name for name in RETIRED_MODULES if (BACKEND_DIR / (name.replace(".", "/") + ".py")).exists()]

    assert importable == []
    assert leftover_files == []


def test_no_python_file_references_a_retired_module() -> None:
    hits = [
        hit
        for path in _scanned_files()
        for hit in find_retired_references(
            path.read_text(encoding="utf-8"),
            str(path.relative_to(BACKEND_DIR)),
            in_orchestration_root=path.parent == ORCHESTRATION_DIR,
        )
    ]

    assert hits == []


def test_the_retired_scan_covers_the_real_tree() -> None:
    scanned = {str(path.relative_to(BACKEND_DIR)) for path in _scanned_files()}

    assert len(scanned) > 400
    assert "app/main.py" in scanned
    assert "scripts/check_structure.py" in scanned
    assert "tests/baseline/test_b7_import_cycles.py" in scanned


def test_retired_modules_are_distinct_orchestration_paths() -> None:
    assert len(set(RETIRED_MODULES)) == len(RETIRED_MODULES) == 31
    assert all(re.fullmatch(r"app\.orchestration\.[a-z_]+", name) for name in RETIRED_MODULES)


def _retired_hits(source: str, **kwargs: bool) -> list[str]:
    return find_retired_references(source, "synthetic.py", **kwargs)


def test_retired_scan_catches_a_from_import_of_a_retired_module() -> None:
    hits = _retired_hits("from app.orchestration.trip_service import persist_trip\n")

    assert hits == ["synthetic.py:1 imports app.orchestration.trip_service"]


def test_retired_scan_catches_a_module_object_import_with_an_alias() -> None:
    hits = _retired_hits("from app.orchestration import scan_service as ss, integrity\n")

    assert hits == ["synthetic.py:1 imports app.orchestration.scan_service"]


def test_retired_scan_catches_a_dotted_import_and_a_function_level_import() -> None:
    source = (
        "import app.orchestration.phase_gate\n"
        "\n"
        "def f():\n"
        "    from app.orchestration.phase_plan import build_phase_plan\n"
    )

    assert len(_retired_hits(source)) == 2


def test_retired_scan_catches_a_string_path_and_a_file_path() -> None:
    source = (
        'TARGET = "app.orchestration.phase_service.anchor_subject"\n'
        'PATH = "app/orchestration/exception_service.py"\n'
        'def f(): "see app.orchestration.vehicle_service for details"\n'
    )

    assert len(_retired_hits(source)) == 3


def test_retired_scan_catches_a_relative_import_only_inside_the_orchestration_root() -> None:
    source = "from . import review_policy\nfrom .scan_service import ingest_scans\n"

    assert len(_retired_hits(source, in_orchestration_root=True)) == 2
    assert _retired_hits(source) == []


def test_retired_scan_ignores_live_modules_and_lookalike_names() -> None:
    source = (
        "from app.orchestration.phases.service import complete_phase\n"
        "from app.orchestration.exceptions import review_identity\n"
        "from app.orchestration.exceptions.review_policy import X\n"
        "from app.orchestration import integrity\n"
        'A = "app.orchestration.phase_service_extras.thing"\n'
        'B = "app.orchestration.exceptions.review_identity.fn"\n'
    )

    assert _retired_hits(source) == []
