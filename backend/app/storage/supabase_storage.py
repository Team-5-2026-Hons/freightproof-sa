"""Supabase Storage I/O for evidence artifacts (photos, documents).

Bucket name is fixed, not configurable — one bucket per environment, never
shared with other Supabase projects. POPIA: only the file and its hash are
stored here; no PII fields beyond what's in the photo itself.
"""

import asyncio
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from supabase import Client, create_client

from app.core.config import settings

logger = logging.getLogger(__name__)

_BUCKET = "evidence-artifacts"
MAX_EVIDENCE_FILE_SIZE_BYTES = 10 * 1024 * 1024
_STORAGE_DOWNLOAD_TIMEOUT_SECONDS = 15.0
_EVIDENCE_DOWNLOAD_SLOTS = asyncio.Semaphore(8)
_STORAGE_ERROR_BODY_LIMIT = 4096


class EvidenceObjectIntegrityError(RuntimeError):
    """Stored evidence cannot be the bounded object accepted at upload time."""


class EvidenceObjectNotFoundError(EvidenceObjectIntegrityError):
    """An evidence row points at an object that no longer exists."""


class EvidenceStorageUnavailableError(RuntimeError):
    """Storage could not be reached reliably enough to verify evidence."""


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


async def create_signed_url(*, s3_bucket: str, s3_key: str, ttl_seconds: int) -> str | None:
    """Mint a time-limited read URL for one stored object.

    Returns None when Storage declines to sign (missing object, storage error) rather than
    raising: the caller lists many artifacts and one unreadable object must degrade that row
    to metadata-only, not fail the request.
    """
    client = _get_client()
    response = client.storage.from_(s3_bucket).create_signed_url(s3_key, expires_in=ttl_seconds)

    signed = response.get("signedURL") if isinstance(response, dict) else None
    if not signed:
        logger.warning("Storage declined to sign %s/%s", s3_bucket, s3_key)
        return None
    return signed


def _storage_object_url(*, s3_bucket: str, s3_key: str) -> str:
    """Build a private-object URL without allowing stored paths to alter the host."""
    bucket_parts = s3_bucket.split("/")
    key_parts = s3_key.split("/")
    if (
        s3_bucket != _BUCKET
        or len(bucket_parts) != 1
        or any(part in {"", ".", ".."} for part in (*bucket_parts, *key_parts))
    ):
        raise EvidenceObjectIntegrityError("Evidence storage location is invalid")
    bucket_path = quote(s3_bucket, safe="")
    object_path = "/".join(quote(part, safe="") for part in key_parts)
    nonce = uuid.uuid4().hex
    return (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/"
        f"{bucket_path}/{object_path}?cacheNonce={nonce}"
    )


async def hash_stored_evidence_file(*, s3_bucket: str, s3_key: str) -> str:
    """Stream and hash the current private object without trusting a CDN-cached copy."""
    url = _storage_object_url(s3_bucket=s3_bucket, s3_key=s3_key)
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Accept-Encoding": "identity",
    }
    digest = hashlib.sha256()
    total_bytes = 0

    try:
        # Supabase documents cacheNonce as the origin-read escape hatch. The stream
        # also caps memory and bandwidth if an object was replaced outside this app's
        # upload path, which rejects anything over MAX_EVIDENCE_FILE_SIZE_BYTES.
        async with asyncio.timeout(_STORAGE_DOWNLOAD_TIMEOUT_SECONDS):
            async with _EVIDENCE_DOWNLOAD_SLOTS:
                timeout = httpx.Timeout(_STORAGE_DOWNLOAD_TIMEOUT_SECONDS, connect=5.0)
                # Redirects are deliberately disabled: HTTPX strips Authorization
                # cross-origin but retains the service-role apikey header.
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                    async with client.stream("GET", url, headers=headers) as response:
                        if response.status_code != 200:
                            # Older Storage gateways wrap NoSuchKey in HTTP 400. A
                            # tenant/configuration 404 is not evidence of file deletion.
                            error_body = bytearray()
                            async for chunk in response.aiter_raw():
                                error_body.extend(chunk[:_STORAGE_ERROR_BODY_LIMIT - len(error_body)])
                                if len(error_body) >= _STORAGE_ERROR_BODY_LIMIT:
                                    break
                            try:
                                error = json.loads(error_body)
                            except (ValueError, UnicodeDecodeError):
                                error = {}
                            code = error.get("code") if isinstance(error, dict) else None
                            legacy_missing = isinstance(error, dict) and (
                                str(error.get("statusCode")) == "404"
                                or error.get("error") == "not_found"
                            )
                            if response.status_code in (400, 404) and (
                                code in ("NoSuchKey", "NoSuchBucket", "not_found")
                                or (code is None and (legacy_missing or response.status_code == 404))
                            ):
                                raise EvidenceObjectNotFoundError("Anchored evidence object is missing")
                            logger.error(
                                "Supabase Storage rejected evidence verification status=%s",
                                response.status_code,
                            )
                            raise EvidenceStorageUnavailableError("Evidence storage is unavailable")

                        if response.headers.get("content-encoding", "identity").lower() != "identity":
                            raise EvidenceStorageUnavailableError("Storage returned encoded evidence bytes")

                        content_length = response.headers.get("content-length")
                        if content_length is not None:
                            try:
                                if int(content_length) > MAX_EVIDENCE_FILE_SIZE_BYTES:
                                    raise EvidenceObjectIntegrityError(
                                        "Anchored evidence object is too large",
                                    )
                            except ValueError as exc:
                                raise EvidenceStorageUnavailableError("Storage returned invalid length") from exc

                        async for chunk in response.aiter_raw():
                            total_bytes += len(chunk)
                            if total_bytes > MAX_EVIDENCE_FILE_SIZE_BYTES:
                                raise EvidenceObjectIntegrityError("Anchored evidence object is too large")
                            digest.update(chunk)
    except EvidenceObjectIntegrityError:
        raise
    except EvidenceStorageUnavailableError:
        raise
    except httpx.HTTPError as exc:
        logger.exception("Supabase Storage could not be reached for evidence verification")
        raise EvidenceStorageUnavailableError("Evidence storage is unavailable") from exc
    except Exception as exc:  # noqa: BLE001 - normalize client/transport failures at this boundary
        logger.exception("Supabase Storage could not be reached for evidence verification")
        raise EvidenceStorageUnavailableError("Evidence storage is unavailable") from exc

    return digest.hexdigest()
