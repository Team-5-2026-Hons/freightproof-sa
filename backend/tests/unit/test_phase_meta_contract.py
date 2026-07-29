"""Decision S2: the backend owns STEP_SLUGS and the frontend mirrors it. This
test is the only thing making that duplication safe — it parses the TS file
rather than trusting a comment. If it fails, the two lists disagree and one of
them is lying to a consumer."""

import re
from pathlib import Path

from app.core.phase_meta import STEP_SLUGS
from app.db.models.enums import PhaseType

_TS_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "shared" / "lib" / "constants" / "phase-meta.ts"
)
_BLOCK = re.compile(
    r"export const STEP_SLUGS:[^=]*=\s*\{(?P<body>.*?)\n\}", re.DOTALL,
)
_ENTRY = re.compile(r"^\s*(?P<key>\w+):\s*\[(?P<items>[^\]]*)\],\s*$", re.MULTILINE)


def _parse_ts_step_slugs() -> dict[str, tuple[str, ...]]:
    source = _TS_PATH.read_text(encoding="utf-8")
    block = _BLOCK.search(source)
    assert block is not None, f"STEP_SLUGS block not found in {_TS_PATH}"
    parsed: dict[str, tuple[str, ...]] = {}
    for entry in _ENTRY.finditer(block.group("body")):
        items = [i.strip().strip("'\"") for i in entry.group("items").split(",")]
        parsed[entry.group("key")] = tuple(i for i in items if i)
    return parsed


def test_backend_step_slugs_match_shared_typescript_constant():
    ts = _parse_ts_step_slugs()
    py = {phase_type.value: slugs for phase_type, slugs in STEP_SLUGS.items()}

    assert ts == py, (
        "STEP_SLUGS disagree between backend/app/core/phase_meta.py and "
        "frontend/shared/lib/constants/phase-meta.ts. Decision S2 requires them "
        "identical; update whichever one is stale."
    )


def test_every_phase_type_has_a_recipe_entry():
    """A new PhaseType with no entry would KeyError at serialization time, in
    production, on one trip shape only."""
    assert set(STEP_SLUGS) == set(PhaseType)
