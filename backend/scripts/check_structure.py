"""Structure ratchet for backend/app: stop god functions and god files from growing.

Run from backend/:

    python scripts/check_structure.py            # check; exit 1 on a violation
    python scripts/check_structure.py --update   # regenerate structure-baseline.json

Why this exists: ruff's C901 / PLR0915 / PLR0913 measure complexity, statement count and
argument count. None of them measure physical length, so a 300-line function made of
simple statements passes them all. This script measures length directly.

Fails when:
  (a) a function not in the baseline is longer than FUNCTION_LINE_LIMIT lines;
  (b) a function already in the baseline (already over the limit) grew;
  (c) a file listed in the baseline's "files" grew.

Shrinking is always allowed. When the tree shrinks, the script says so and suggests
--update so the baseline tightens to the new, smaller numbers.

Length is end_lineno - lineno + 1, so methods and nested functions count, and the
decorator lines do not (lineno is the `def` line). Functions are keyed by
file path + qualified name, e.g. "app/orchestration/trips/creation.py::persist_trip".

A function that is moved or renamed is a *new* function to this script, so a pure move of
an over-limit function trips (a). Run --update in the move commit and let the reviewer
read the baseline diff; --update prints what it added, grew and removed.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

# A function longer than this must already be in the baseline, or the check fails.
FUNCTION_LINE_LIMIT = 100

APP_DIR_NAME = "app"
BASELINE_FILE_NAME = "structure-baseline.json"
DEFAULT_ROOT = Path(__file__).resolve().parent.parent

# Seeds the baseline's "files" section the first time --update runs. After that the
# baseline file itself is the source of truth, so removing a file from tracking is a
# one-line edit to the JSON, not a change to this script.
INITIAL_TRACKED_FILES: tuple[str, ...] = (
    "app/orchestration/phase_service.py",
    "app/integrations/parcel_perfect.py",
    "app/orchestration/exception_service.py",
    "app/orchestration/trip_service.py",
    "app/orchestration/action_location_service.py",
    "app/schemas/trips.py",
    "app/api/v1/endpoints/handover.py",
)

FunctionLengths = dict[str, int]
FileLengths = dict[str, int]


class FunctionCollector(ast.NodeVisitor):
    """Collects (qualified name, line count) for every def, including methods and nested defs."""

    def __init__(self) -> None:
        self.lengths: list[tuple[str, int]] = []
        self._scope: list[str] = []

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        qualified = ".".join([*self._scope, node.name])
        # end_lineno is None only for synthetic nodes; parsed source always has it.
        assert node.end_lineno is not None
        self.lengths.append((qualified, node.end_lineno - node.lineno + 1))
        # "<locals>" mirrors Python's own __qualname__, so a nested function can never
        # collide with a method of the same name on a class.
        self._scope.extend([node.name, "<locals>"])
        self.generic_visit(node)
        del self._scope[-2:]

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._scope.append(node.name)
        self.generic_visit(node)
        self._scope.pop()


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def measure_functions(root: Path) -> FunctionLengths:
    """Line count of every function under root/app, keyed by 'path::qualified.name'.

    If one qualified name is defined twice in a file (an if/else pair of defs), the longer
    one is kept: the ratchet must never miss the bigger of the two.
    """
    lengths: FunctionLengths = {}
    for path in sorted((root / APP_DIR_NAME).rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            # A file that cannot be parsed cannot be measured. Failing loudly beats
            # silently skipping it and reporting a clean tree.
            raise SystemExit(f"check_structure: cannot parse {path}: {exc}") from exc
        collector = FunctionCollector()
        collector.visit(tree)
        for qualified, length in collector.lengths:
            key = f"{_relative(path, root)}::{qualified}"
            lengths[key] = max(length, lengths.get(key, 0))
    return lengths


def measure_files(root: Path, relative_paths: list[str]) -> FileLengths:
    """Physical line count of each named file; files that no longer exist are omitted."""
    return {
        rel: len((root / rel).read_text(encoding="utf-8").splitlines())
        for rel in relative_paths
        if (root / rel).is_file()
    }


def build_baseline(root: Path, tracked_files: list[str]) -> dict[str, object]:
    functions = measure_functions(root)
    return {
        "function_line_limit": FUNCTION_LINE_LIMIT,
        "functions": {
            key: length
            for key, length in sorted(functions.items())
            if length > FUNCTION_LINE_LIMIT
        },
        "files": measure_files(root, tracked_files),
    }


def load_baseline(root: Path) -> dict[str, object]:
    path = root / BASELINE_FILE_NAME
    if not path.is_file():
        raise SystemExit(
            f"check_structure: {BASELINE_FILE_NAME} not found. "
            "Run `python scripts/check_structure.py --update` to create it."
        )
    loaded: dict[str, object] = json.loads(path.read_text(encoding="utf-8"))
    return loaded


def check(root: Path) -> tuple[list[str], list[str]]:
    """Return (violations, shrink notices). Violations fail the run; notices do not."""
    baseline = load_baseline(root)
    base_functions: FunctionLengths = baseline["functions"]  # type: ignore[assignment]
    base_files: FileLengths = baseline["files"]  # type: ignore[assignment]

    violations: list[str] = []
    notices: list[str] = []

    for key, length in sorted(measure_functions(root).items()):
        recorded = base_functions.get(key)
        if recorded is None:
            if length > FUNCTION_LINE_LIMIT:
                violations.append(
                    f"(a) new function over {FUNCTION_LINE_LIMIT} lines: {key} is {length} lines. "
                    "Split it. If this is a pure move of a baselined function, run --update."
                )
        elif length > recorded:
            violations.append(
                f"(b) oversized function grew: {key} was {recorded} lines, now {length}."
            )
        elif length < recorded:
            notices.append(f"function shrank: {key} {recorded} -> {length}")

    current_files = measure_files(root, list(base_files))
    for rel, recorded in sorted(base_files.items()):
        current = current_files.get(rel)
        if current is None:
            notices.append(f"baselined file no longer exists: {rel}")
        elif current > recorded:
            violations.append(f"(c) baselined file grew: {rel} was {recorded} lines, now {current}.")
        elif current < recorded:
            notices.append(f"file shrank: {rel} {recorded} -> {current}")

    return violations, notices


def _describe_change(old: dict[str, object], new: dict[str, object]) -> list[str]:
    """Human-readable diff of two baselines, printed by --update for the reviewer."""
    lines: list[str] = []
    for section in ("functions", "files"):
        before: dict[str, int] = old.get(section, {})  # type: ignore[assignment]
        after: dict[str, int] = new[section]  # type: ignore[assignment]
        for key in sorted(after.keys() - before.keys()):
            lines.append(f"  + {section[:-1]} added: {key} = {after[key]}")
        for key in sorted(before.keys() - after.keys()):
            lines.append(f"  - {section[:-1]} removed: {key} (was {before[key]})")
        for key in sorted(after.keys() & before.keys()):
            if after[key] > before[key]:
                lines.append(f"  ^ {section[:-1]} GREW: {key} {before[key]} -> {after[key]}")
            elif after[key] < before[key]:
                lines.append(f"  v {section[:-1]} shrank: {key} {before[key]} -> {after[key]}")
    return lines


def update(root: Path) -> list[str]:
    path = root / BASELINE_FILE_NAME
    old: dict[str, object] = {}
    tracked = list(INITIAL_TRACKED_FILES)
    if path.is_file():
        old = json.loads(path.read_text(encoding="utf-8"))
        tracked = list(old["files"])  # type: ignore[call-overload]
    new = build_baseline(root, tracked)
    path.write_text(json.dumps(new, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return _describe_change(old, new)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument("--update", action="store_true", help="regenerate the baseline")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="backend directory (tests override this)")
    args = parser.parse_args(argv)
    root: Path = args.root.resolve()

    if args.update:
        changes = update(root)
        print(f"Wrote {BASELINE_FILE_NAME}.")
        for line in changes:
            print(line)
        return 0

    violations, notices = check(root)
    for notice in notices:
        print(f"note: {notice}")
    if notices:
        print("note: the tree shrank; run `python scripts/check_structure.py --update` to tighten the baseline.")
    if violations:
        print("check_structure FAILED:", file=sys.stderr)
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        return 1
    print("check_structure OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
