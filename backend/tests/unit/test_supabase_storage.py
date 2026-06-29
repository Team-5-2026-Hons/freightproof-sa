import pytest

from app.storage.supabase_storage import upload_evidence_file


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
