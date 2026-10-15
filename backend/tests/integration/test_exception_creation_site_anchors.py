"""FP-290 Task 3: every place that creates a TripException owes the right anchor events.

Rule under test: critical -> a raise event; warning/info -> none; a row born reviewed by its
author (override / cancellation note) -> a review event. Three layers, because the plan's
"matrix over every creation site" must keep holding as sites are added:

* a structural guard: every `TripException(` construction in app/ is either hooked through
  register_exception, built by the creation service, or provably a constant-WARNING row;
* the hook's behaviour across the severity/authorship matrix;
* real workflows for the critical sites that can be driven end to end.
"""

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import (
    BlockchainReceiptType, ExceptionSeverity, ExceptionSource, ExceptionType, PhaseType,
)
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.transit import TripException
from app.orchestration.evidence.road_check import check_trip_on_road
from app.orchestration.evidence_anchors.recording import register_exception
from app.orchestration.exceptions.review_policy import dispatcher_authored_review, initial_review_status

from tests.conftest import make_token
from tests.integration._evidence_anchor_world import World, seed_world
from tests.integration.test_arrival_phase import _complete_arrival, _seed_trip, _walk_to_arrival
from tests.integration.test_phases import _make_artifact, override_get_db  # noqa: F401
from tests.integration.test_road_check import (  # noqa: F401
    _FAR_FROM_MID, _MID, _seed, _stage, mock_pulsit,
)

_APP = Path(__file__).resolve().parents[2] / "app"

# Files whose constructions go through register_exception: path -> number of hooked sites.
HOOKED_SITES = {
    "orchestration/evidence/road_check.py": 1,
    "orchestration/handover/receiver_verification.py": 1,
    "orchestration/phases/advance_departure.py": 1,
    "orchestration/phases/findings.py": 2,
    "orchestration/phases/override.py": 1,   # the authored note; its seal warning is below
    "orchestration/trips/administration.py": 1,
}
# Built by the driver-facing creation service, which anchors via prepare_exception_anchors.
CREATION_SERVICE = {"orchestration/exceptions/creation.py": 1}
# Raw constructions that are provably constant-WARNING and not authored: they owe nothing.
WARNING_ONLY_SITES = {
    "orchestration/consignments/scans.py": 1,
    "orchestration/evidence/action_location.py": 2,
    "orchestration/phases/advance_confirmation.py": 1,
    "orchestration/phases/findings.py": 2,
    "orchestration/phases/override.py": 1,
}


def _constructions() -> dict[str, dict[str, int]]:
    found: dict[str, dict[str, int]] = {}
    for path in _APP.rglob("*.py"):
        lines = path.read_text().splitlines()
        for index, line in enumerate(lines):
            if "TripException(" not in line or line.lstrip().startswith(("class ", "#")) or "model_validate" in line:
                continue
            rel = str(path.relative_to(_APP))
            kind = "hooked" if "register_exception(db, TripException(" in line else "raw"
            if kind == "raw":
                block = "\n".join(lines[index:index + 16])
                if rel in CREATION_SERVICE:
                    kind = "creation"
                else:
                    # A raw site must be a constant WARNING row, with no authored-review spread.
                    code = "\n".join(
                        text for text in lines[index:index + 40] if not text.lstrip().startswith("#")
                    )
                    severity = re.search(r"severity\s*=\s*([\w.]+)", code)
                    source = path.read_text()
                    assert severity is not None and (
                        severity.group(1) == "ExceptionSeverity.WARNING"
                        or (
                            severity.group(1) == "_DISCREPANCY_SEVERITY"
                            and "_DISCREPANCY_SEVERITY = ExceptionSeverity.WARNING" in source
                        )
                    ), f"{rel}:{index + 1} builds a TripException that may be critical but is not hooked"
                    assert "dispatcher_authored_review" not in block, f"{rel}:{index + 1} is authored but not hooked"
                    kind = "warning_only"
            found.setdefault(kind, {}).setdefault(rel, 0)
            found[kind][rel] += 1
    return found


def test_every_creation_site_is_hooked_or_provably_owes_nothing():
    found = _constructions()

    assert found.get("hooked", {}) == HOOKED_SITES
    assert found.get("creation", {}) == CREATION_SERVICE
    assert found.get("warning_only", {}) == WARNING_ONLY_SITES


@pytest_asyncio.fixture
async def world(db_session) -> World:
    return await seed_world(db_session)


async def _events_for(db, exception_id: uuid.UUID) -> list[str]:
    rows = (await db.execute(select(EvidenceAnchorEvent.receipt_type).where(
        EvidenceAnchorEvent.exception_id == exception_id))).scalars().all()
    return sorted(str(getattr(r, "value", r)) for r in rows)


@pytest.mark.parametrize(("severity", "authored", "expected"), [
    (ExceptionSeverity.CRITICAL, False, ["exception_raised"]),
    (ExceptionSeverity.WARNING, False, []),
    (ExceptionSeverity.INFO, False, []),
    (ExceptionSeverity.WARNING, True, ["exception_reviewed"]),
    (ExceptionSeverity.CRITICAL, True, ["exception_raised", "exception_reviewed"]),
])
async def test_hook_owes_events_by_severity_and_authorship(db_session, world, severity, authored, expected):
    extra = dispatcher_authored_review(user_id=world.user.id, at=datetime.now(UTC)) if authored else {
        "review_status": initial_review_status(severity)}
    row = TripException(
        trip_id=world.trip_id, exception_type=ExceptionType.DISPATCHER_NOTE,
        source=ExceptionSource.SYSTEM, severity=severity, description="Matrix row", **extra,
    )

    await register_exception(db_session, row)

    assert await _events_for(db_session, row.id) == expected


# ── Real workflows ────────────────────────────────────────────────────────────

async def test_road_check_critical_finding_freezes_a_raise_event(db_session):
    seed = await _seed(db_session, completed_through=PhaseType.DEPARTURE)
    await _stage(seed["trip"], seed["horse"].pulsit_device_id, _MID)
    await _stage(seed["trip"], seed["trailer"].pulsit_device_id, _FAR_FROM_MID)
    trip_id = seed["trip"].id

    await check_trip_on_road(db_session, trip=seed["trip"])

    [row] = (await db_session.execute(select(TripException).where(TripException.trip_id == trip_id))).scalars().all()
    assert row.severity == ExceptionSeverity.CRITICAL
    [event] = (await db_session.execute(select(EvidenceAnchorEvent))).scalars().all()
    assert event.exception_id == row.id and event.receipt_type == BlockchainReceiptType.EXCEPTION_RAISED
    # GPS stays in Postgres: the frozen payload has no coordinates.
    assert "gps" not in str(event.payload_json) and "lat" not in str(event.payload_json)


async def test_arrival_seal_findings_freeze_one_raise_event_each(client: AsyncClient, db_session):
    trip, driver = await _seed_trip(db_session)
    trip_id = trip.id
    token = make_token(sub=str(driver.id), role="driver")
    await _walk_to_arrival(client, db_session, trip, token)
    seal_photo_id = await _make_artifact(db_session, trip_id)

    response = await _complete_arrival(
        client, trip_id, token, seal_photo_artifact_id=seal_photo_id,
        seal_condition="damaged", seal_number_at_arrival="ZZ-9999",
    )

    assert response.status_code == 200, response.text
    critical = {e["id"] for e in response.json()["exceptions"] if e["severity"] == "critical"}
    assert len(critical) == 2
    events = (await db_session.execute(select(EvidenceAnchorEvent).where(
        EvidenceAnchorEvent.trip_id == trip_id))).scalars().all()
    assert {str(e.exception_id) for e in events} == critical
    assert {e.receipt_type for e in events} == {BlockchainReceiptType.EXCEPTION_RAISED}
