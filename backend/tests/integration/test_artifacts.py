"""Integration tests for POST /api/v1/artifacts (driver evidence upload)."""

import hashlib
import io
import logging
import uuid

import pytest
import pytest_asyncio
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import artifacts as artifacts_endpoint
from app.db.models.enums import (
    ArtifactType, EvidenceRole, IdvsStatus, OrganizationType, PhaseStatus, PhaseType,
    TripStatus, VehicleType,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.core.realtime import EventSeverity, RealtimeKind
from app.orchestration.evidence.artifacts import create_artifact
from app.orchestration.evidence.attribution import EvidenceAttribution
from app.orchestration.integrity import is_unique_violation, violated_constraint
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import Driver, User
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle
from app.db.session import get_db
from app.main import app

from tests.conftest import auth_header, make_token

# A real JPEG signature (SOI + APP0), padded. The upload path re-derives the content type
# from the bytes rather than trusting the client's declared one — see
# app/storage/mime_allowlist.py — so a placeholder like b"fakejpegbytes" is now correctly
# rejected as "not any allowed format". Tests that want a successful upload have to send
# something that genuinely looks like an image.
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 32


@pytest_asyncio.fixture(autouse=True)
async def override_get_db(db_session):
    async def _get_db():
        yield db_session
    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_trip(db_session):
    org = Organization(id=uuid.uuid4(), name="Org", org_type=OrganizationType.OPERATOR)
    client_org = Organization(id=uuid.uuid4(), name="Client", org_type=OrganizationType.PRINCIPAL)
    db_session.add_all([org, client_org])
    await db_session.flush()
    user = User(id=uuid.uuid4(), organization_id=org.id, email="d@test.co.za", full_name="D")
    driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Driver",
        id_number="8001015009087", phone_number="+27821234567", license_number="DRV-1",
    )
    horse = Vehicle(
        id=uuid.uuid4(), organization_id=org.id, vehicle_type=VehicleType.HORSE,
        registration="ABC123GP", pulsit_device_id="PUL-1",
    )
    origin = Precinct(id=uuid.uuid4(), name="O", principal_organization_id=client_org.id, latitude="0", longitude="0")
    dest = Precinct(id=uuid.uuid4(), name="D", principal_organization_id=client_org.id, latitude="1", longitude="1")
    db_session.add_all([user, driver, horse, origin, dest])
    await db_session.flush()
    trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-ART", order_number="ORD-ART",
        operator_organization_id=org.id, client_organization_id=client_org.id,
        driver_id=driver.id, horse_id=horse.id,
        origin_precinct_id=origin.id, destination_precinct_id=dest.id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=user.id,
    )
    db_session.add(trip)
    await db_session.flush()
    return trip, driver


async def test_upload_artifact_returns_201_with_id(client: AsyncClient, seed_trip, monkeypatch):
    from app.storage.supabase_storage import UploadResult

    trip, driver = seed_trip

    async def fake_upload(*, trip_id, file_bytes, mime_type):
        return UploadResult(s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/x", file_hash="a" * 64)

    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake_upload)

    token = make_token(sub=str(driver.id), role="driver")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "id" in body
    assert body["file_hash"] == "a" * 64


async def test_upload_artifact_over_10mb_returns_413(
    client: AsyncClient, seed_trip, monkeypatch: pytest.MonkeyPatch,
):
    """413, not 422, since the size is now rejected from the declared content length
    BEFORE the body is read — which is the point: an oversized upload no longer has to be
    spooled to disk in full just to be measured and thrown away.

    413 is also what the driver app already models for this case: it raises a synthetic
    ApiError(413) client-side (lib/api/artifacts.ts) precisely so an oversized photo is
    treated as TERMINAL rather than queued for retry (isQueueableFailure retries only
    status 0 and >=500). A real 413 from the server now takes the same path; a 422 would
    have been a second, inconsistent code for one condition.
    """
    trip, driver = seed_trip
    # The 10 MB ceiling is pinned by value, then shrunk for the request: the size check
    # compares against the constant whatever its value, and a real 10 MB multipart body
    # took ~5s to build and parse — the slowest test in the suite.
    assert artifacts_endpoint.MAX_FILE_SIZE_BYTES == 10 * 1024 * 1024
    monkeypatch.setattr(artifacts_endpoint, "MAX_FILE_SIZE_BYTES", len(JPEG_BYTES))

    token = make_token(sub=str(driver.id), role="driver")
    big = io.BytesIO(JPEG_BYTES + b"\x00")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("big.jpg", big, "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 413


async def test_upload_of_html_labelled_as_a_photo_is_refused(client: AsyncClient, seed_trip):
    """The stored-XSS path this endpoint used to leave open.

    The content type was taken from the client and written straight onto the Storage
    object, so a handset could store a page as "evidence" and the dispatcher's browser
    would render it when they opened the signed URL. The type is now re-derived from the
    bytes, so the declared `image/jpeg` no longer buys anything.
    """
    trip, driver = seed_trip

    token = make_token(sub=str(driver.id), role="driver")
    html = io.BytesIO(b"<html><script>alert(document.cookie)</script></html>")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", html, "image/jpeg")},
        headers=auth_header(token),
    )

    assert resp.status_code == 422
    assert "Unsupported file type" in resp.json()["detail"]


async def test_upload_artifact_for_someone_elses_trip_returns_403(client: AsyncClient, db_session, seed_trip):
    trip, _driver = seed_trip
    org = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.OPERATOR)
    db_session.add(org)
    await db_session.flush()
    other_driver = Driver(
        id=uuid.uuid4(), organization_id=org.id, full_name="Other",
        id_number="8001015009088", phone_number="+27820000000", license_number="DRV-X",
    )
    db_session.add(other_driver)
    await db_session.flush()

    token = make_token(sub=str(other_driver.id), role="driver")
    resp = await client.post(
        "/api/v1/artifacts",
        data={
            "trip_id": str(trip.id),
            "artifact_type": "photo",
            "captured_at": "2026-06-24T08:00:00Z",
        },
        files={"file": ("gate.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")},
        headers=auth_header(token),
    )
    assert resp.status_code == 403


# ── Attribution columns: constraints are declared on the model, because tests build the
# schema with create_all and never run the migration ────────────────────────────────

async def _seed_phase(db_session, trip: Trip, phase_type: PhaseType = PhaseType.LOADING) -> PhaseEvent:
    phase = PhaseEvent(
        id=uuid.uuid4(), trip_id=trip.id, phase_type=phase_type,
        sequence_number=1, status=PhaseStatus.PENDING,
    )
    db_session.add(phase)
    await db_session.flush()
    return phase


def _artifact(
    trip: Trip, *, file_hash: str = "a" * 64,
    phase_event_id: uuid.UUID | None = None, evidence_role: EvidenceRole | None = None,
) -> EvidenceArtifact:
    return EvidenceArtifact(
        id=uuid.uuid4(), trip_id=trip.id, artifact_type=ArtifactType.PHOTO,
        s3_key=f"{trip.id}/{uuid.uuid4()}", s3_bucket="evidence-artifacts", file_hash=file_hash,
        mime_type="image/jpeg", captured_at=datetime.now(UTC),
        phase_event_id=phase_event_id, evidence_role=evidence_role,
    )


async def test_attribution_half_pair_violates_check(db_session, seed_trip):
    trip, _driver = seed_trip
    phase = await _seed_phase(db_session, trip)

    with pytest.raises(IntegrityError) as raised:
        async with db_session.begin_nested():
            db_session.add(_artifact(trip, phase_event_id=phase.id, evidence_role=None))
            await db_session.flush()

    assert violated_constraint(raised.value) == "ck_evidence_artifacts_attribution_pair"


async def test_second_row_same_phase_role_hash_violates_unique(db_session, seed_trip):
    trip, _driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    db_session.add(_artifact(trip, phase_event_id=phase.id, evidence_role=EvidenceRole.LINEHAUL_PHOTO))
    await db_session.flush()

    with pytest.raises(IntegrityError) as raised:
        async with db_session.begin_nested():
            db_session.add(
                _artifact(trip, phase_event_id=phase.id, evidence_role=EvidenceRole.LINEHAUL_PHOTO)
            )
            await db_session.flush()

    assert is_unique_violation(raised.value)
    assert violated_constraint(raised.value) == "uq_evidence_artifacts_phase_role_hash"


async def test_unattributed_rows_may_share_a_hash(db_session, seed_trip):
    """Rows written before attribution existed can already share a hash; the partial index
    must not make them illegal."""
    trip, _driver = seed_trip
    db_session.add_all([_artifact(trip), _artifact(trip)])

    await db_session.flush()


# ── Attributed upload ──────────────────────────────────────────────────────────

_OUTBOX_KEY = "realtime_outbox"
_ARTIFACTS_LOGGER = "app.orchestration.evidence.artifacts"


class _FakeStorage:
    """Hashes the real bytes, as supabase_storage does, so identical-content lookups can hit
    (the older fake above returns a constant hash and would never deduplicate)."""

    def __init__(self) -> None:
        self.uploads = 0
        self.returned_at: datetime | None = None

    async def upload(self, *, trip_id, file_bytes, mime_type):
        from app.storage.supabase_storage import UploadResult

        self.uploads += 1
        self.returned_at = datetime.now(UTC)
        return UploadResult(
            s3_bucket="evidence-artifacts", s3_key=f"{trip_id}/{uuid.uuid4()}",
            file_hash=hashlib.sha256(file_bytes).hexdigest(),
        )


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> _FakeStorage:
    fake = _FakeStorage()
    monkeypatch.setattr("app.orchestration.evidence.artifacts.upload_evidence_file", fake.upload)
    return fake


# One token per driver for the whole test: a second token for the same driver starts a new
# session, and the one-device rule (app/auth/sessions.py) rejects a same-second repeat.
_DRIVER_TOKENS: dict[uuid.UUID, str] = {}


def _driver_token(driver: Driver) -> str:
    if driver.id not in _DRIVER_TOKENS:
        _DRIVER_TOKENS[driver.id] = make_token(sub=str(driver.id), role="driver")
    return _DRIVER_TOKENS[driver.id]


def _photo(variant: int = 0) -> bytes:
    """Distinct bytes per variant, still a valid JPEG signature."""
    return JPEG_BYTES + bytes([variant]) * 8


async def _post_photo(
    client: AsyncClient, driver, trip: Trip, *, photo: bytes | None = None,
    phase_event_id: uuid.UUID | str | None = None, evidence_role: str | None = None,
    captured_at: str = "2026-06-24T08:00:00Z",
):
    data = {"trip_id": str(trip.id), "artifact_type": "photo", "captured_at": captured_at}
    if phase_event_id is not None:
        data["phase_event_id"] = str(phase_event_id)
    if evidence_role is not None:
        data["evidence_role"] = evidence_role
    return await client.post(
        "/api/v1/artifacts", data=data,
        files={"file": ("p.jpg", io.BytesIO(photo or _photo()), "image/jpeg")},
        headers=auth_header(_driver_token(driver)),
    )


async def _artifact_rows(db_session, trip: Trip) -> list[EvidenceArtifact]:
    result = await db_session.execute(select(EvidenceArtifact).where(EvidenceArtifact.trip_id == trip.id))
    return list(result.scalars().all())


_DRAINED: list[tuple[uuid.UUID, object]] = []


@pytest.fixture(autouse=True)
def record_drained_events(monkeypatch: pytest.MonkeyPatch):
    """Savepoint releases fire the session's after_commit hook (SQLAlchemy treats a nested
    commit as a commit), which drains the outbox mid-test. Recording what the hook drains
    lets the tests count every event the code queued, wherever it was in the outbox."""
    from app.core import realtime

    _DRAINED.clear()
    monkeypatch.setattr(realtime, "_schedule_publish", lambda org_id, event: _DRAINED.append((org_id, event)))


def _evidence_events(db_session) -> list:
    queued = [*_DRAINED, *db_session.info.get(_OUTBOX_KEY, [])]
    return [(org_id, event) for org_id, event in queued if event.kind == RealtimeKind.EVIDENCE_UPLOADED]


async def test_upload_with_attribution_stores_phase_and_role(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)

    resp = await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    assert resp.status_code == 201
    assert resp.json()["phase_event_id"] == str(phase.id)
    assert resp.json()["evidence_role"] == "linehaul_photo"
    [row] = await _artifact_rows(db_session, trip)
    assert (row.phase_event_id, row.evidence_role) == (phase.id, EvidenceRole.LINEHAUL_PHOTO)


@pytest.mark.parametrize("only", ["phase_event_id", "evidence_role"])
async def test_upload_with_half_attribution_returns_422(client, db_session, seed_trip, storage, only):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    fields = {"phase_event_id": phase.id, "evidence_role": "linehaul_photo"}

    resp = await _post_photo(client, driver, trip, **{only: fields[only]})

    assert resp.status_code == 422
    assert await _artifact_rows(db_session, trip) == []
    assert storage.uploads == 0


async def test_upload_attributed_to_another_trips_phase_returns_404(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    other_trip = Trip(
        id=uuid.uuid4(), trip_reference="FP-TEST-OTHER", order_number="ORD-OTHER",
        operator_organization_id=trip.operator_organization_id,
        client_organization_id=trip.client_organization_id,
        driver_id=trip.driver_id, horse_id=trip.horse_id,
        origin_precinct_id=trip.origin_precinct_id, destination_precinct_id=trip.destination_precinct_id,
        status=TripStatus.CREATED, idvs_check_status=IdvsStatus.VERIFIED,
        created_by_user_id=trip.created_by_user_id,
    )
    db_session.add(other_trip)
    await db_session.flush()
    foreign_phase = await _seed_phase(db_session, other_trip)

    resp = await _post_photo(client, driver, trip, phase_event_id=foreign_phase.id, evidence_role="linehaul_photo")

    assert resp.status_code == 404
    assert storage.uploads == 0


async def test_upload_role_not_valid_for_phase_returns_422(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    loading = await _seed_phase(db_session, trip, PhaseType.LOADING)

    resp = await _post_photo(client, driver, trip, phase_event_id=loading.id, evidence_role="seal_photo")

    assert resp.status_code == 422
    assert await _artifact_rows(db_session, trip) == []


async def test_driver_cannot_upload_pod_signature_returns_422(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    confirmation = await _seed_phase(db_session, trip, PhaseType.CONFIRMATION)

    resp = await _post_photo(client, driver, trip, phase_event_id=confirmation.id, evidence_role="pod_signature")

    assert resp.status_code == 422
    assert await _artifact_rows(db_session, trip) == []


async def test_identical_content_returns_existing_artifact_unchanged(
    client, db_session, seed_trip, storage, caplog,
):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    first = await _post_photo(
        client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo",
        captured_at="2026-06-24T08:00:00Z",
    )

    with caplog.at_level(logging.WARNING, logger=_ARTIFACTS_LOGGER):
        retry = await _post_photo(
            client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo",
            captured_at="2026-06-24T09:30:00Z",
        )

    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    [row] = await _artifact_rows(db_session, trip)
    assert row.captured_at == datetime(2026, 6, 24, 8, 0, tzinfo=UTC)
    assert storage.uploads == 1
    assert len(_evidence_events(db_session)) == 1
    warning = next(r for r in caplog.records if r.levelno == logging.WARNING)
    assert first.json()["id"] in warning.getMessage()


async def test_retake_with_different_bytes_creates_second_artifact(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)

    first = await _post_photo(client, driver, trip, photo=_photo(1), phase_event_id=phase.id, evidence_role="linehaul_photo")
    second = await _post_photo(client, driver, trip, photo=_photo(2), phase_event_id=phase.id, evidence_role="linehaul_photo")

    assert first.json()["id"] != second.json()["id"]
    assert len(await _artifact_rows(db_session, trip)) == 2
    assert len(_evidence_events(db_session)) == 2


async def test_upload_to_completed_phase_is_accepted(client, db_session, seed_trip, storage):
    """Rejecting a late upload would make a queued phase entry fail on its upload step."""
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    phase.status = PhaseStatus.COMPLETED
    phase.completed_at = datetime.now(UTC)
    await db_session.flush()

    resp = await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    assert resp.status_code == 201
    assert resp.json()["phase_event_id"] == str(phase.id)


async def test_unattributed_upload_unchanged(client, db_session, seed_trip, storage):
    trip, driver = seed_trip

    resp = await _post_photo(client, driver, trip)

    assert resp.status_code == 201
    assert resp.json()["phase_event_id"] is None
    assert resp.json()["evidence_role"] is None
    [row] = await _artifact_rows(db_session, trip)
    assert (row.phase_event_id, row.evidence_role) == (None, None)


async def test_new_attributed_upload_enqueues_one_info_evidence_event(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)

    await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    [(org_id, event)] = _evidence_events(db_session)
    assert org_id == trip.operator_organization_id
    assert event.id == trip.id
    assert event.severity == EventSeverity.INFO
    # Ids and kind only (POPIA): no coordinates, names or artifact details on the wire.
    assert set(event.model_dump()) == {"resource", "id", "kind", "severity", "ts"}


async def test_rolled_back_upload_leaves_no_row_and_publishes_nothing(
    db_session, seed_trip, storage, monkeypatch,
):
    from unittest.mock import AsyncMock

    from app.core import realtime

    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    publish = AsyncMock()
    monkeypatch.setattr(realtime, "publish_event", publish)
    realtime.register_realtime_hook()

    result = await create_artifact(
        db_session, trip_id=trip.id, file_bytes=_photo(), mime_type="image/jpeg",
        artifact_type=ArtifactType.PHOTO, captured_at=datetime.now(UTC),
        captured_by_driver_id=driver.id,
        attribution=EvidenceAttribution(phase_event_id=phase.id, role=EvidenceRole.LINEHAUL_PHOTO),
    )
    assert len(_evidence_events(db_session)) == 1  # queued, not yet published
    await db_session.rollback()

    assert (await db_session.execute(
        select(func.count()).select_from(EvidenceArtifact).where(EvidenceArtifact.id == result.id)
    )).scalar_one() == 0
    assert db_session.info.get(_OUTBOX_KEY) in (None, [])
    publish.assert_not_called()


async def test_created_at_is_stamped_after_storage(client, db_session, seed_trip, storage):
    """created_at is record-creation time, not the transaction's start (the column default),
    so "Received" can never precede the moment the file was stored."""
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)

    resp = await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    [row] = await _artifact_rows(db_session, trip)
    assert storage.returned_at is not None
    assert row.created_at >= storage.returned_at
    assert resp.json()["created_at"] is not None


async def test_deduplicated_retry_keeps_original_created_at(client, db_session, seed_trip, storage):
    trip, driver = seed_trip
    phase = await _seed_phase(db_session, trip)
    first = await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    retry = await _post_photo(client, driver, trip, phase_event_id=phase.id, evidence_role="linehaul_photo")

    assert retry.json()["created_at"] == first.json()["created_at"]
