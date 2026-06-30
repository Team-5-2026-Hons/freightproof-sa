"""Supabase Storage I/O for evidence artifacts (photos, documents).

Bucket name is fixed, not configurable — one bucket per environment, never
shared with other Supabase projects. POPIA: only the file and its hash are
stored here; no PII fields beyond what's in the photo itself.
"""

import hashlib
import uuid
from dataclasses import dataclass

from supabase import Client, create_client

from app.core.config import settings

_BUCKET = "evidence-artifacts"


@dataclass
class UploadResult:
    s3_bucket: str
    s3_key: str
    file_hash: str


def _get_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


async def upload_evidence_file(*, trip_id: str, file_bytes: bytes, mime_type: str) -> UploadResult:
    """Upload one file under `{trip_id}/{uuid}` and return its storage location + SHA-256 hash."""
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    key = f"{trip_id}/{uuid.uuid4()}"

    client = _get_client()
    client.storage.from_(_BUCKET).upload(key, file_bytes, file_options={"content-type": mime_type})

    return UploadResult(s3_bucket=_BUCKET, s3_key=key, file_hash=file_hash)
