import asyncio
import hashlib

import httpx
import pytest
import respx

from app.core.config import settings
from app.storage.supabase_storage import (
    MAX_EVIDENCE_FILE_SIZE_BYTES,
    EvidenceObjectIntegrityError,
    EvidenceObjectNotFoundError,
    EvidenceStorageUnavailableError,
    create_signed_url,
    hash_stored_evidence_file,
    upload_evidence_file,
)


@pytest.mark.asyncio
async def test_upload_evidence_file_returns_key_bucket_and_hash(monkeypatch):
    class FakeStorageBucket:
        def upload(self, path, file_bytes, file_options=None):
            return {"path": path}

    class FakeStorage:
        def from_(self, bucket):
            assert bucket == "evidence-artifacts"
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    result = await upload_evidence_file(
        trip_id="11111111-1111-1111-1111-111111111111",
        file_bytes=b"hello world",
        mime_type="image/jpeg",
    )
    assert result.s3_bucket == "evidence-artifacts"
    assert result.s3_key.startswith("11111111-1111-1111-1111-111111111111/")
    assert len(result.file_hash) == 64


@pytest.mark.asyncio
async def test_create_signed_url_returns_url_for_ttl(monkeypatch):
    captured: dict = {}

    class FakeStorageBucket:
        def create_signed_url(self, path, expires_in):
            captured["path"] = path
            captured["expires_in"] = expires_in
            return {"signedURL": f"https://storage.test/{path}?token=abc"}

    class FakeStorage:
        def from_(self, bucket):
            assert bucket == "evidence-artifacts"
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    url = await create_signed_url(
        s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1", ttl_seconds=300,
    )

    assert url == "https://storage.test/trip-1/artifact-1?token=abc"
    assert captured["path"] == "trip-1/artifact-1"
    assert captured["expires_in"] == 300


@pytest.mark.asyncio
async def test_create_signed_url_returns_none_when_storage_omits_url(monkeypatch):
    """A missing object yields a response with no signedURL. That degrades one artifact
    to metadata-only — it must not raise and abort the whole list."""
    class FakeStorageBucket:
        def create_signed_url(self, path, expires_in):
            return {"error": "Object not found"}

    class FakeStorage:
        def from_(self, bucket):
            return FakeStorageBucket()

    class FakeSupabaseClient:
        storage = FakeStorage()

    monkeypatch.setattr("app.storage.supabase_storage._get_client", lambda: FakeSupabaseClient())

    url = await create_signed_url(
        s3_bucket="evidence-artifacts", s3_key="trip-1/missing", ttl_seconds=300,
    )

    assert url is None


def _private_object_url(key: str) -> str:
    return (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/"
        f"evidence-artifacts/{key}"
    )


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_hashes_cache_busted_stream():
    file_bytes = b"the bytes currently stored"
    route = respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        return_value=httpx.Response(200, content=file_bytes),
    )

    digest = await hash_stored_evidence_file(
        s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
    )

    assert digest == hashlib.sha256(file_bytes).hexdigest()
    request = route.calls.last.request
    assert request.url.params["cacheNonce"]
    assert request.headers["authorization"].startswith("Bearer ")
    assert request.headers["apikey"]


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_distinguishes_missing_object():
    respx.get(url__startswith=_private_object_url("trip-1/missing")).mock(
        return_value=httpx.Response(404),
    )

    with pytest.raises(EvidenceObjectNotFoundError):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/missing",
        )


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_maps_storage_failure():
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        return_value=httpx.Response(503),
    )

    with pytest.raises(EvidenceStorageUnavailableError):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_maps_transport_failure():
    request = httpx.Request("GET", _private_object_url("trip-1/artifact-1"))
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        side_effect=httpx.ReadTimeout("timed out", request=request),
    )

    with pytest.raises(EvidenceStorageUnavailableError):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_rejects_oversized_replacement():
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        return_value=httpx.Response(
            200,
            headers={"content-length": str(MAX_EVIDENCE_FILE_SIZE_BYTES + 1)},
        ),
    )

    with pytest.raises(EvidenceObjectIntegrityError, match="too large"):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_uses_a_fresh_cache_nonce_each_time():
    route = respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        return_value=httpx.Response(200, content=b"evidence"),
    )

    for _ in range(2):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )

    nonces = [call.request.url.params["cacheNonce"] for call in route.calls]
    assert len(nonces) == len(set(nonces)) == 2


@pytest.mark.asyncio
@respx.mock
async def test_hash_stored_evidence_file_does_not_forward_credentials_on_redirect():
    redirected = respx.get("https://untrusted.test/object").mock(
        return_value=httpx.Response(200, content=b"not evidence"),
    )
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).mock(
        return_value=httpx.Response(302, headers={"location": "https://untrusted.test/object"}),
    )

    with pytest.raises(EvidenceStorageUnavailableError):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )

    assert not redirected.called


@pytest.mark.asyncio
async def test_hash_stored_evidence_file_treats_invalid_location_as_integrity_failure():
    with pytest.raises(EvidenceObjectIntegrityError, match="location is invalid"):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="../auth/v1/admin/users",
        )


@pytest.mark.asyncio
async def test_hash_stored_evidence_file_times_out_waiting_for_download_slot(monkeypatch):
    monkeypatch.setattr("app.storage.supabase_storage._EVIDENCE_DOWNLOAD_SLOTS", asyncio.Semaphore(0))
    monkeypatch.setattr("app.storage.supabase_storage._STORAGE_DOWNLOAD_TIMEOUT_SECONDS", 0.01)

    with pytest.raises(EvidenceStorageUnavailableError):
        await hash_stored_evidence_file(
            s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1",
        )


@pytest.mark.parametrize("status,body,expected", [
    (400, {"statusCode": "404", "error": "not_found"}, EvidenceObjectNotFoundError),
    (400, {"code": "NoSuchKey"}, EvidenceObjectNotFoundError),
    (404, {"code": "TenantNotFound"}, EvidenceStorageUnavailableError),
    (403, {"code": "AccessDenied"}, EvidenceStorageUnavailableError),
    (206, {}, EvidenceStorageUnavailableError),
])
@respx.mock
async def test_storage_error_envelopes_do_not_confuse_missing_files_with_outages(status, body, expected):
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).respond(status, json=body)
    with pytest.raises(expected):
        await hash_stored_evidence_file(s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1")


@respx.mock
async def test_storage_stream_is_bounded_without_content_length(monkeypatch):
    class Chunked(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"12345678"
            yield b"9"
            pytest.fail("The download must stop as soon as its byte budget is exceeded")

    monkeypatch.setattr("app.storage.supabase_storage.MAX_EVIDENCE_FILE_SIZE_BYTES", 8)
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).respond(200, stream=Chunked())
    with pytest.raises(EvidenceObjectIntegrityError):
        await hash_stored_evidence_file(s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1")


@respx.mock
async def test_storage_deadline_covers_slow_stream_and_releases_slot(monkeypatch):
    closed = asyncio.Event()

    class Stalled(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"first"
            await asyncio.sleep(10)

        async def aclose(self):
            closed.set()

    slots = asyncio.Semaphore(1)
    monkeypatch.setattr("app.storage.supabase_storage._EVIDENCE_DOWNLOAD_SLOTS", slots)
    monkeypatch.setattr("app.storage.supabase_storage._STORAGE_DOWNLOAD_TIMEOUT_SECONDS", 0.1)
    respx.get(url__startswith=_private_object_url("trip-1/artifact-1")).respond(200, stream=Stalled())
    with pytest.raises(EvidenceStorageUnavailableError):
        await hash_stored_evidence_file(s3_bucket="evidence-artifacts", s3_key="trip-1/artifact-1")
    assert closed.is_set()
    assert not slots.locked()
