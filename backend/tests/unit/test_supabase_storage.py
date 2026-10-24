import asyncio
import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import get_ident
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
import respx
from storage3 import SyncStorageClient
from storage3.exceptions import StorageApiError

from app.core.config import settings
from app.storage import supabase_storage
from app.storage.supabase_storage import (
    MAX_EVIDENCE_FILE_SIZE_BYTES,
    EvidenceObjectIntegrityError,
    EvidenceObjectNotFoundError,
    EvidenceStorageUnavailableError,
    create_signed_url,
    hash_stored_evidence_file,
    upload_evidence_file,
)


@pytest.fixture(autouse=True)
def isolate_signing_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    # Worker-local clients must not outlive the SDK double belonging to a test.
    monkeypatch.setattr(supabase_storage, "_SIGNING_CLIENTS", type(supabase_storage._SIGNING_CLIENTS)())


@pytest.mark.parametrize("failure", [
    StorageApiError("Object not found", "not_found", 404),
    httpx.ConnectError("Storage is unavailable"),
    httpx.ReadTimeout("Storage timed out"),
])
async def test_signing_failure_preserves_metadata_only_fallback(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, failure: Exception,
) -> None:
    bucket = SimpleNamespace(create_signed_url=Mock(side_effect=failure))
    client = SimpleNamespace(storage=SimpleNamespace(from_=lambda _: bucket))
    monkeypatch.setattr(supabase_storage, "_get_client", lambda: client)

    url = await create_signed_url(s3_bucket="evidence-artifacts", s3_key="unavailable", ttl_seconds=300)

    assert url is None
    assert "Storage could not sign" in caplog.text


@pytest.mark.parametrize("failure", [ValueError("invalid SDK use"), AttributeError("invalid SDK use")])
async def test_signing_does_not_hide_programming_errors(
    monkeypatch: pytest.MonkeyPatch, failure: Exception,
) -> None:
    bucket = SimpleNamespace(create_signed_url=Mock(side_effect=failure))
    client = SimpleNamespace(storage=SimpleNamespace(from_=lambda _: bucket))
    monkeypatch.setattr(supabase_storage, "_get_client", lambda: client)

    with pytest.raises(type(failure), match="invalid SDK use"):
        await create_signed_url(s3_bucket="evidence-artifacts", s3_key="artifact", ttl_seconds=300)


async def test_signing_re_raises_instead_of_looping_on_a_cyclic_cause_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = AttributeError("invalid SDK use")
    second = AttributeError("invalid SDK use")
    first.__cause__ = second
    second.__cause__ = first
    bucket = SimpleNamespace(create_signed_url=Mock(side_effect=first))
    client = SimpleNamespace(storage=SimpleNamespace(from_=lambda _: bucket))
    monkeypatch.setattr(supabase_storage, "_get_client", lambda: client)

    with pytest.raises(AttributeError, match="invalid SDK use"):
        await asyncio.wait_for(
            create_signed_url(s3_bucket="evidence-artifacts", s3_key="artifact", ttl_seconds=300),
            timeout=5,
        )


@pytest.mark.parametrize("status,body", [(502, b"<html>Bad Gateway</html>"), (503, b'{"message":"Unavailable"}')])
async def test_signing_retains_fallback_when_sdk_cannot_parse_gateway_error(
    monkeypatch: pytest.MonkeyPatch, status: int, body: bytes,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=body)

    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        storage = SyncStorageClient("https://storage.test/storage/v1/", {}, http_client=transport)
        monkeypatch.setattr(supabase_storage, "_get_client", lambda: SimpleNamespace(storage=storage))

        url = await create_signed_url(s3_bucket="evidence-artifacts", s3_key="artifact", ttl_seconds=300)

    assert url is None


async def test_signing_runs_off_the_event_loop_and_reuses_its_worker_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop_thread = get_ident()
    signing_threads: list[int] = []

    def sign(path: str, expires_in: int) -> dict[str, str]:
        signing_threads.append(get_ident())
        return {"signedURL": f"https://storage.test/{path}?ttl={expires_in}"}

    client = SimpleNamespace(storage=SimpleNamespace(from_=lambda _: SimpleNamespace(create_signed_url=sign)))
    make_client = Mock(return_value=client)
    monkeypatch.setattr(supabase_storage, "_get_client", make_client)
    # One worker makes reuse deterministic without sharing a mutable SDK client across threads.
    with ThreadPoolExecutor(max_workers=1) as executor:
        asyncio.get_running_loop().set_default_executor(executor)

        first = await create_signed_url(s3_bucket="evidence-artifacts", s3_key="first", ttl_seconds=300)
        second = await create_signed_url(s3_bucket="evidence-artifacts", s3_key="second", ttl_seconds=300)

    assert first == "https://storage.test/first?ttl=300"
    assert second == "https://storage.test/second?ttl=300"
    assert len(signing_threads) == 2
    assert all(thread != loop_thread for thread in signing_threads)
    assert make_client.call_count == 1


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
