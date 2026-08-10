import pytest

from app.storage.supabase_storage import create_signed_url, upload_evidence_file


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
