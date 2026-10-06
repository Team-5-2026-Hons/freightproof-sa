"""B7 — Every module under app/ must import cleanly on its own, in a fresh interpreter.

Why one process per module: importing the whole app (what the test suite and uvicorn do)
hides circular imports that depend on ORDER. If `app.tasks.blockchain` is the first thing
imported, it runs before `app.orchestration.phase_service` has finished and a module-level
back-reference blows up; but once something else has imported phase_service first, the same
import works. phase_service <-> tasks.blockchain and phase_service -> verification_service
-> phase_service are exactly that shape today, held together by function-level imports
(audit section 4.2). The package split must not turn a lazy import into a real cycle, and
a cold import of any single module is the only check that sees it.

Marked slow: ~160 interpreter start-ups. The processes run concurrently from one fixture;
each test then only reads its module's result. CI runs this file in its own step because
the main step excludes slow tests (see .github/workflows/ci.yml).
"""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"

# One cold import is normally 1-3s (FastAPI, SQLAlchemy, Pydantic, Celery). The ceiling only
# has to be safely above a loaded CI runner: a hung import is a bug, not a slow machine.
IMPORT_TIMEOUT_SECONDS = 120
MAX_PARALLEL_IMPORTS = 8

pytestmark = pytest.mark.slow


def _module_name(path: Path) -> str:
    relative = path.relative_to(BACKEND_DIR).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def all_app_modules() -> list[str]:
    return sorted(_module_name(path) for path in APP_DIR.rglob("*.py"))


def _import_in_fresh_interpreter(module: str) -> tuple[int, str]:
    completed = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=BACKEND_DIR, env=dict(os.environ), capture_output=True, text=True,
        timeout=IMPORT_TIMEOUT_SECONDS, check=False,
    )
    return completed.returncode, completed.stderr[-1500:]


@pytest.fixture(scope="module")
def import_results() -> dict[str, tuple[int, str]]:
    modules = all_app_modules()
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_IMPORTS) as pool:
        return dict(zip(modules, pool.map(_import_in_fresh_interpreter, modules), strict=True))


@pytest.mark.parametrize("module", all_app_modules())
def test_module_imports_cleanly_in_a_fresh_interpreter(
    module: str, import_results: dict[str, tuple[int, str]],
) -> None:
    returncode, stderr = import_results[module]

    assert returncode == 0, f"`import {module}` failed in a fresh interpreter:\n{stderr}"


def test_module_discovery_covers_the_whole_app() -> None:
    modules = all_app_modules()

    assert "app.main" in modules
    assert "app.orchestration.phase_service" in modules
    assert "app.tasks.blockchain" in modules
    assert len(modules) > 100
