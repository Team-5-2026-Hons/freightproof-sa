"""Snapshot helper for the behaviour-baseline tests (audit docs/design-notes/2026-10-06-...).

A snapshot test compares live output with a JSON file committed under snapshots/ and
fails on ANY difference. Refactors in audit phases 2-5 must produce an empty diff.

Regenerating on purpose:

    UPDATE_SNAPSHOTS=1 backend/.venv/bin/pytest backend/tests/baseline

Only do this when the change is intended (a new endpoint, a new field), and read the
resulting `git diff` before committing: the diff is the review. A snapshot that is missing
is a failure, never a silent write, so a typo in a name cannot "pass" by creating a file.
"""

import difflib
import json
import os
from pathlib import Path
from typing import Any

SNAPSHOT_DIR = Path(__file__).resolve().parent / "snapshots"
UPDATE_ENV_VAR = "UPDATE_SNAPSHOTS"

# How many differing lines to show in a failure. The full diff is one `git diff` away
# after regenerating; a 40k-line OpenAPI diff in the pytest output helps nobody.
MAX_DIFF_LINES = 60


def dump(data: Any) -> str:
    """Stable text form: sorted keys and a trailing newline, so diffs are line-oriented."""
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def assert_matches_snapshot(name: str, data: Any) -> None:
    path = SNAPSHOT_DIR / name
    actual = dump(data)

    if os.environ.get(UPDATE_ENV_VAR) == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(actual, encoding="utf-8")
        return

    if not path.is_file():
        raise AssertionError(
            f"Snapshot {path} does not exist. Generate it deliberately with "
            f"{UPDATE_ENV_VAR}=1 pytest tests/baseline and commit it."
        )

    expected = path.read_text(encoding="utf-8")
    if actual == expected:
        return

    diff = list(difflib.unified_diff(
        expected.splitlines(), actual.splitlines(),
        fromfile=f"snapshots/{name} (committed)", tofile="live", lineterm="", n=1,
    ))
    shown = "\n".join(diff[:MAX_DIFF_LINES])
    more = f"\n... {len(diff) - MAX_DIFF_LINES} more diff lines" if len(diff) > MAX_DIFF_LINES else ""
    raise AssertionError(
        f"Behaviour changed: snapshot {name} no longer matches.\n{shown}{more}\n"
        f"If the change is intended, regenerate with {UPDATE_ENV_VAR}=1 and review the git diff."
    )
