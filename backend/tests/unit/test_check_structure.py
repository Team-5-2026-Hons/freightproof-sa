"""Unit tests for scripts/check_structure.py, run against throwaway trees in tmp_path.

The real backend/app tree is never read here: a test that depended on today's function
lengths would fail the moment someone legitimately shrank a function.
"""

import json
from pathlib import Path

import pytest

from scripts.check_structure import (
    BASELINE_FILE_NAME,
    FUNCTION_LINE_LIMIT,
    check,
    main,
    measure_functions,
    update,
)


def _function_source(name: str, total_lines: int) -> str:
    """A syntactically valid function spanning exactly total_lines lines (def line included)."""
    body = ["    value = 1"] * (total_lines - 2)
    return "\n".join([f"def {name}() -> int:", *body, "    return value", ""])


def _write_module(root: Path, relative: str, source: str) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path


def _write_baseline(root: Path, functions: dict[str, int], files: dict[str, int]) -> None:
    (root / BASELINE_FILE_NAME).write_text(
        json.dumps({"function_line_limit": FUNCTION_LINE_LIMIT, "functions": functions, "files": files}),
        encoding="utf-8",
    )


def test_unchanged_tree_passes(tmp_path: Path) -> None:
    _write_module(tmp_path, "app/big.py", _function_source("legacy", FUNCTION_LINE_LIMIT + 50))
    _write_module(tmp_path, "app/small.py", _function_source("tidy", 10))
    update(tmp_path)

    violations, _ = check(tmp_path)

    assert violations == []
    assert main(["--root", str(tmp_path)]) == 0


def test_new_function_of_101_lines_fails(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    _write_module(tmp_path, "app/small.py", _function_source("tidy", 10))
    update(tmp_path)
    _write_module(tmp_path, "app/fresh.py", _function_source("too_long", FUNCTION_LINE_LIMIT + 1))

    exit_code = main(["--root", str(tmp_path)])

    assert exit_code == 1
    assert "app/fresh.py::too_long" in capsys.readouterr().err


def test_new_function_of_exactly_100_lines_passes(tmp_path: Path) -> None:
    _write_module(tmp_path, "app/small.py", _function_source("tidy", 10))
    update(tmp_path)
    _write_module(tmp_path, "app/edge.py", _function_source("at_the_limit", FUNCTION_LINE_LIMIT))

    violations, _ = check(tmp_path)

    assert violations == []


def test_oversized_function_growing_by_one_line_fails(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = _write_module(tmp_path, "app/legacy.py", _function_source("persist", FUNCTION_LINE_LIMIT + 50))
    update(tmp_path)
    path.write_text(_function_source("persist", FUNCTION_LINE_LIMIT + 51), encoding="utf-8")

    exit_code = main(["--root", str(tmp_path)])

    assert exit_code == 1
    assert "app/legacy.py::persist" in capsys.readouterr().err


def test_oversized_function_shrinking_passes_and_suggests_update(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _write_module(tmp_path, "app/legacy.py", _function_source("persist", FUNCTION_LINE_LIMIT + 50))
    update(tmp_path)
    path.write_text(_function_source("persist", FUNCTION_LINE_LIMIT + 10), encoding="utf-8")

    exit_code = main(["--root", str(tmp_path)])

    assert exit_code == 0
    assert "--update" in capsys.readouterr().out


def test_baselined_file_growing_by_one_line_fails(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = _function_source("tidy", 10)
    path = _write_module(tmp_path, "app/god_module.py", source)
    _write_baseline(tmp_path, functions={}, files={"app/god_module.py": len(source.splitlines())})
    path.write_text(source + "# one more line\n", encoding="utf-8")

    exit_code = main(["--root", str(tmp_path)])

    assert exit_code == 1
    assert "app/god_module.py" in capsys.readouterr().err


def test_baselined_file_staying_the_same_size_passes(tmp_path: Path) -> None:
    source = _function_source("tidy", 10)
    _write_module(tmp_path, "app/god_module.py", source)
    _write_baseline(tmp_path, functions={}, files={"app/god_module.py": len(source.splitlines())})

    violations, _ = check(tmp_path)

    assert violations == []


def test_methods_and_nested_functions_are_measured_and_keyed_by_qualified_name(tmp_path: Path) -> None:
    _write_module(
        tmp_path,
        "app/shapes.py",
        "class Service:\n"
        "    def method(self) -> int:\n"
        "        def inner() -> int:\n"
        "            return 1\n"
        "        return inner()\n",
    )

    lengths = measure_functions(tmp_path)

    assert lengths == {
        "app/shapes.py::Service.method": 4,
        "app/shapes.py::Service.method.<locals>.inner": 2,
    }


def test_update_regenerates_baseline_and_reports_growth(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = _write_module(tmp_path, "app/legacy.py", _function_source("persist", FUNCTION_LINE_LIMIT + 5))
    update(tmp_path)
    path.write_text(_function_source("persist", FUNCTION_LINE_LIMIT + 9), encoding="utf-8")

    exit_code = main(["--root", str(tmp_path), "--update"])

    assert exit_code == 0
    assert "GREW" in capsys.readouterr().out
    recorded = json.loads((tmp_path / BASELINE_FILE_NAME).read_text(encoding="utf-8"))
    assert recorded["functions"] == {"app/legacy.py::persist": FUNCTION_LINE_LIMIT + 9}


def test_missing_baseline_exits_with_instructions(tmp_path: Path) -> None:
    _write_module(tmp_path, "app/small.py", _function_source("tidy", 10))

    with pytest.raises(SystemExit) as raised:
        main(["--root", str(tmp_path)])

    assert "--update" in str(raised.value)
