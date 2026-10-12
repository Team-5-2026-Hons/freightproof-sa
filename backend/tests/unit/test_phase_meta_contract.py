"""The backend owns STEP_SLUGS and the frontend mirrors it. This
test is the only thing making that duplication safe — it parses the TS file
rather than trusting a comment. If it fails, the two lists disagree and one of
them is lying to a consumer."""

import re
from pathlib import Path

from app.core.phase_meta import DRIVER_UPLOAD_ROLES, EVIDENCE_ROLES, STEP_SLUGS
from app.db.models.enums import EvidenceRole, PhaseType
from app.db.models.phases import PhaseEvent

_TS_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "shared" / "lib" / "constants" / "phase-meta.ts"
)
_BLOCK = re.compile(
    r"export const STEP_SLUGS:[^=]*=\s*\{(?P<body>.*?)\n\}", re.DOTALL,
)
_ENTRY = re.compile(r"^\s*(?P<key>\w+):\s*\[(?P<items>[^\]]*)\],\s*$", re.MULTILINE)
_ROLES_BLOCK = re.compile(
    r"export const EVIDENCE_ROLES:[^=]*=\s*\{(?P<body>.*?)\n\}", re.DOTALL,
)


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
        "frontend/shared/lib/constants/phase-meta.ts. They must stay "
        "identical; update whichever one is stale."
    )


def test_every_phase_type_has_a_recipe_entry():
    """A new PhaseType with no entry would KeyError at serialization time, in
    production, on one trip shape only."""
    assert set(STEP_SLUGS) == set(PhaseType)


def _parse_ts_evidence_roles() -> dict[str, frozenset[str]]:
    source = _TS_PATH.read_text(encoding="utf-8")
    block = _ROLES_BLOCK.search(source)
    assert block is not None, f"EVIDENCE_ROLES block not found in {_TS_PATH}"
    parsed: dict[str, frozenset[str]] = {}
    for entry in _ENTRY.finditer(block.group("body")):
        items = [i.strip().strip("'\"") for i in entry.group("items").split(",")]
        parsed[entry.group("key")] = frozenset(i for i in items if i)
    return parsed


def test_backend_evidence_roles_match_shared_typescript_constant():
    ts = _parse_ts_evidence_roles()
    py = {
        phase_type.value: frozenset(role.value for role in roles)
        for phase_type, roles in EVIDENCE_ROLES.items()
    }

    assert ts == py, (
        "EVIDENCE_ROLES disagree between backend/app/core/phase_meta.py and "
        "frontend/shared/lib/constants/phase-meta.ts. They must stay identical."
    )


def test_every_phase_type_has_an_evidence_role_entry():
    """A missing entry would KeyError when attribution is validated, on one phase type only."""
    assert set(EVIDENCE_ROLES) == set(PhaseType)


def test_every_role_names_an_existing_phase_column():
    """A role is a column stem: the submitted copy lives in <role>_artifact_id, so a
    role with no column could be uploaded but never submitted."""
    for role in EvidenceRole:
        assert hasattr(PhaseEvent, f"{role.value}_artifact_id"), role


def test_pod_signature_is_not_driver_uploadable():
    assert EvidenceRole.POD_SIGNATURE not in DRIVER_UPLOAD_ROLES
    assert DRIVER_UPLOAD_ROLES == set(EvidenceRole) - {EvidenceRole.POD_SIGNATURE}
