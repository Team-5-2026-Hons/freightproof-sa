"""Structural rules for the integrations.parcel_perfect package.

The package's __init__ is a compatibility facade that imports every submodule. A submodule
that imports the facade back therefore forms a cycle through it. import-linter checks this
for every submodule except `factory` (the top tier of its layers contract, which nothing is
above to check), so this test covers all of them, function-level imports included.
"""

import ast
from pathlib import Path

import app.integrations.parcel_perfect as facade

FACADE_MODULE = "app.integrations.parcel_perfect"
PACKAGE_DIR = Path(__file__).resolve().parents[2].joinpath(*FACADE_MODULE.split("."))


def _submodule_names() -> frozenset[str]:
    return frozenset(path.stem for path in PACKAGE_DIR.glob("*.py") if path.name != "__init__.py")


def _facade_imports(source: str, submodules: frozenset[str], package: str = FACADE_MODULE) -> list[int]:
    """Lines that import the facade itself rather than one of its submodules.

    `from <facade> import mock` is fine (mock is a submodule); `from <facade> import get_pp_client`
    and `import <facade>` are not. Relative imports are resolved against `package` first."""
    offending: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            if any(alias.name == FACADE_MODULE for alias in node.names):
                offending.append(node.lineno)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                anchor = package.rsplit(".", node.level - 1)[0] if node.level > 1 else package
                module = f"{anchor}.{module}" if module else anchor
            if module == FACADE_MODULE and any(alias.name not in submodules for alias in node.names):
                offending.append(node.lineno)
    return offending


def test_no_package_module_imports_the_facade() -> None:
    submodules = _submodule_names()
    assert {"client", "mock", "factory"} <= submodules, "package directory not found"

    offending = {
        path.name: lines
        for path in sorted(PACKAGE_DIR.glob("*.py"))
        if (lines := _facade_imports(path.read_text(encoding="utf-8"), submodules))
    }

    assert offending == {}


def test_facade_import_scan_flags_each_way_of_importing_the_facade() -> None:
    submodules = frozenset({"mock", "models"})
    source = (
        "import app.integrations.parcel_perfect\n"
        "from app.integrations.parcel_perfect import get_pp_client\n"
        "from app.integrations.parcel_perfect import mock, MockParcelPerfectClient\n"
        "from . import PPTrack\n"
        "\n"
        "def lazy():\n"
        "    from app.integrations.parcel_perfect import PPTrack\n"
    )

    assert _facade_imports(source, submodules) == [1, 2, 3, 4, 7]


def test_facade_import_scan_allows_submodule_imports() -> None:
    submodules = frozenset({"mock", "models"})
    source = (
        "import app.integrations.parcel_perfect.models\n"
        "from app.integrations.parcel_perfect import mock\n"
        "from app.integrations.parcel_perfect.models import PPTrack\n"
        "from .models import PPTrack as Track\n"
        "from . import models\n"
        "from app.integrations.mock_state import build_key\n"
    )

    assert _facade_imports(source, submodules) == []


def test_facade_does_not_re_export_the_rebound_token_cache() -> None:
    # client.py rebinds _cached_token with `global`, so a copy on the facade would be a stale
    # snapshot that never sees the new token. Leaving it off makes a test that reads or
    # assigns it through the facade fail loudly instead of silently testing nothing.
    assert not hasattr(facade, "_cached_token")
