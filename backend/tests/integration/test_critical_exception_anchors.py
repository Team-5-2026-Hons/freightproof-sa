"""FP-290 Task 1: a critical driver report with photos commits one frozen anchor event.

Covers the request contract (photo list, legacy singular field, 422/404 rules), the frozen
event written in the report's own transaction, idempotent replay, and that a warning report
creates no event. Hedera is never reached here: the worker entry point is called directly.
"""

import uuid
from unittest.mock import patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select

from app.blockchain.anchor_service import compute_payload_hash
from app.core.constants import MAX_EXCEPTION_PHOTOS
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AnchorStatus, BlockchainReceiptType, SubjectType
from app.db.models.evidence_anchors import EvidenceAnchorEvent, ExceptionArtifact
from app.db.models.transit import TripException
from app.db.session import get_db
from app.main import app
from app.orchestration.evidence_anchors.execution import anchor_evidence_event

from tests.conftest import auth_header, make_token
from tests.integration._evidence_anchor_world import World, make_artifact, seed_world

_CRITICAL = "seal_broken_in_transit"
_WARNING = "cargo_damage"


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def world(db_session) -> World:
    return await seed_world(db_session)


async def _post(client: AsyncClient, world: World, body: dict):
    token = world.__dict__.setdefault("token", make_token(sub=str(world.driver.id), role="driver"))
    return await client.post(
        f"/api/v1/trips/{world.trip.id}/exceptions",
        json={"description": "Seal found cut open.", **body}, headers=auth_header(token),
    )


async def _counts(db_session) -> tuple[int, int, int]:
    counts = []
    for model in (TripException, ExceptionArtifact, EvidenceAnchorEvent):
        counts.append((await db_session.execute(select(func.count()).select_from(model))).scalar_one())
    return counts[0], counts[1], counts[2]


async def test_critical_report_with_two_photos_freezes_one_pending_event(
    client: AsyncClient, db_session, world,
):
    first = await make_artifact(db_session, world.trip.id)
    second = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_ids": [str(first.id), str(second.id)],
    })

    assert response.status_code == 201
    body = response.json()
    assert [a["id"] for a in body["supporting_artifacts"]] == [str(first.id), str(second.id)]
    assert body["supporting_artifact_id"] == str(first.id)
    assert all("s3_key" not in a and "s3_bucket" not in a for a in body["supporting_artifacts"])
    assert [e["receipt_type"] for e in body["anchor_events"]] == ["exception_raised"]
    assert body["anchor_events"][0]["anchor_status"] == "pending"
    assert body["anchor_events"][0]["receipt_id"] is None
    members = (await db_session.execute(
        select(ExceptionArtifact).where(ExceptionArtifact.exception_id == uuid.UUID(body["id"]))
        .order_by(ExceptionArtifact.position)
    )).scalars().all()
    assert [(m.artifact_id, m.position) for m in members] == [(first.id, 0), (second.id, 1)]
    event = await db_session.get(EvidenceAnchorEvent, uuid.UUID(body["anchor_events"][0]["event_id"]))
    assert event is not None
    assert event.event_hash == compute_payload_hash(event.payload_json)
    assert {p["artifact_id"] for p in event.payload_json["photos"]} == {str(first.id), str(second.id)}
    assert event.payload_json["event_id"] == str(event.id)


async def test_worker_entry_point_anchors_the_frozen_hash_and_links_the_receipt(
    client: AsyncClient, db_session, world,
):
    photo = await make_artifact(db_session, world.trip.id)
    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_ids": [str(photo.id)],
    })
    event_id = uuid.UUID(response.json()["anchor_events"][0]["event_id"])

    anchored = await anchor_evidence_event(db_session, event_id=event_id)

    event = await db_session.get(EvidenceAnchorEvent, event_id)
    assert anchored is True
    assert event is not None and event.anchor_status == AnchorStatus.ANCHORED
    receipt = await db_session.get(BlockchainReceipt, event.receipt_id)
    assert receipt is not None
    assert receipt.subject_type == SubjectType.EVIDENCE_EVENT
    assert receipt.subject_id == event.id
    assert receipt.receipt_type == BlockchainReceiptType.EXCEPTION_RAISED
    assert receipt.trip_id == world.trip.id
    assert receipt.data_hash == event.event_hash


async def test_critical_report_without_photos_commits_an_explicit_empty_photo_list(
    client: AsyncClient, db_session, world,
):
    response = await _post(client, world, {"exception_type": "panic_button"})

    assert response.status_code == 201
    event = await db_session.get(
        EvidenceAnchorEvent, uuid.UUID(response.json()["anchor_events"][0]["event_id"]))
    assert event is not None and event.payload_json["photos"] == []


async def test_legacy_singular_body_becomes_a_one_photo_membership(
    client: AsyncClient, db_session, world,
):
    photo = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_id": str(photo.id),
    })

    assert response.status_code == 201
    body = response.json()
    assert [a["id"] for a in body["supporting_artifacts"]] == [str(photo.id)]
    assert body["supporting_artifact_id"] == str(photo.id)
    event = await db_session.get(
        EvidenceAnchorEvent, uuid.UUID(body["anchor_events"][0]["event_id"]))
    assert event is not None and len(event.payload_json["photos"]) == 1


async def test_both_fields_agreeing_are_accepted(client: AsyncClient, db_session, world):
    first = await make_artifact(db_session, world.trip.id)
    second = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_id": str(first.id),
        "supporting_artifact_ids": [str(first.id), str(second.id)],
    })

    assert response.status_code == 201
    assert len(response.json()["supporting_artifacts"]) == 2


async def test_conflicting_singular_and_list_fields_are_rejected_with_zero_writes(
    client: AsyncClient, db_session, world,
):
    first = await make_artifact(db_session, world.trip.id)
    second = await make_artifact(db_session, world.trip.id)
    before = await _counts(db_session)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_id": str(second.id),
        "supporting_artifact_ids": [str(first.id), str(second.id)],
    })

    assert response.status_code == 422
    assert await _counts(db_session) == before


async def test_empty_list_with_a_singular_photo_is_rejected(client: AsyncClient, db_session, world):
    photo = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_id": str(photo.id),
        "supporting_artifact_ids": [],
    })

    assert response.status_code == 422


async def test_more_than_the_photo_cap_is_rejected(client: AsyncClient, db_session, world):
    ids = [str((await make_artifact(db_session, world.trip.id)).id) for _ in range(MAX_EXCEPTION_PHOTOS + 1)]
    before = await _counts(db_session)

    response = await _post(client, world, {"exception_type": _CRITICAL, "supporting_artifact_ids": ids})

    assert response.status_code == 422
    assert await _counts(db_session) == before


async def test_exactly_the_photo_cap_is_accepted(client: AsyncClient, db_session, world):
    ids = [str((await make_artifact(db_session, world.trip.id)).id) for _ in range(MAX_EXCEPTION_PHOTOS)]

    response = await _post(client, world, {"exception_type": _CRITICAL, "supporting_artifact_ids": ids})

    assert response.status_code == 201
    assert len(response.json()["supporting_artifacts"]) == MAX_EXCEPTION_PHOTOS


async def test_duplicate_photo_ids_are_rejected(client: AsyncClient, db_session, world):
    photo = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_ids": [str(photo.id), str(photo.id)],
    })

    assert response.status_code == 422


async def test_foreign_trip_artifact_is_404_with_zero_writes(client: AsyncClient, db_session, world):
    other = await seed_world(db_session, tag="B")
    mine = await make_artifact(db_session, world.trip.id)
    foreign = await make_artifact(db_session, other.trip.id)
    before = await _counts(db_session)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_ids": [str(mine.id), str(foreign.id)],
    })

    assert response.status_code == 404
    assert await _counts(db_session) == before


async def test_missing_artifact_is_404_with_zero_writes(client: AsyncClient, db_session, world):
    before = await _counts(db_session)

    response = await _post(client, world, {
        "exception_type": _CRITICAL, "supporting_artifact_ids": [str(uuid.uuid4())],
    })

    assert response.status_code == 404
    assert await _counts(db_session) == before


async def test_replay_returns_the_original_report_photos_and_event_even_if_body_differs(
    client: AsyncClient, db_session, world,
):
    first = await make_artifact(db_session, world.trip.id)
    other = await make_artifact(db_session, world.trip.id)
    report_id = str(uuid.uuid4())
    original = await _post(client, world, {
        "exception_type": _CRITICAL, "client_report_id": report_id,
        "supporting_artifact_ids": [str(first.id)],
    })
    before = await _counts(db_session)

    replay = await _post(client, world, {
        "exception_type": _CRITICAL, "client_report_id": report_id, "description": "Different words.",
        "supporting_artifact_ids": [str(other.id)],
    })

    assert replay.status_code == 201
    assert replay.json()["id"] == original.json()["id"]
    assert [a["id"] for a in replay.json()["supporting_artifacts"]] == [str(first.id)]
    assert replay.json()["anchor_events"] == original.json()["anchor_events"]
    assert await _counts(db_session) == before


async def test_replay_that_loses_the_insert_race_returns_the_winner_with_no_extra_rows(
    client: AsyncClient, db_session, world, caplog,
):
    """Both attempts pass the pre-check; the unique index lets one insert through."""
    photo = await make_artifact(db_session, world.trip.id)
    other = await make_artifact(db_session, world.trip.id)
    report_id = str(uuid.uuid4())
    original = await _post(client, world, {
        "exception_type": _CRITICAL, "client_report_id": report_id,
        "supporting_artifact_ids": [str(photo.id)],
    })
    before = await _counts(db_session)

    from app.orchestration.exceptions import creation
    real_find = creation._find_by_client_report_id
    calls = {"n": 0}

    async def blind_once(db, *, trip_id, client_report_id):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real_find(
            db, trip_id=trip_id, client_report_id=client_report_id)

    caplog.set_level("INFO", logger="app.orchestration.exceptions.creation")
    with patch.object(creation, "_find_by_client_report_id", blind_once):
        loser = await _post(client, world, {
            "exception_type": _CRITICAL, "client_report_id": report_id,
            "supporting_artifact_ids": [str(other.id)],
        })

    assert "lost the insert race" in caplog.text
    assert loser.status_code == 201
    assert loser.json()["id"] == original.json()["id"]
    assert [a["id"] for a in loser.json()["supporting_artifacts"]] == [str(photo.id)]
    assert loser.json()["anchor_events"] == original.json()["anchor_events"]
    assert await _counts(db_session) == before


async def test_warning_report_keeps_its_photos_but_creates_no_anchor_event(
    client: AsyncClient, db_session, world,
):
    photo = await make_artifact(db_session, world.trip.id)

    response = await _post(client, world, {
        "exception_type": _WARNING, "supporting_artifact_ids": [str(photo.id)],
    })

    assert response.status_code == 201
    assert response.json()["anchor_events"] == []
    assert len(response.json()["supporting_artifacts"]) == 1
    assert (await _counts(db_session))[2] == 0


async def test_invalid_token_is_401(client: AsyncClient, world):
    response = await client.post(
        f"/api/v1/trips/{world.trip.id}/exceptions",
        json={"exception_type": _CRITICAL, "description": "x"},
        headers=auth_header("not-a-real-token"),
    )

    assert response.status_code == 401
