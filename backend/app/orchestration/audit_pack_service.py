"""Audit Pack lifecycle: preview, issue (snapshot → PDF → store → seal), list, revoke.

Thin coordination only — assembly lives in audit_pack_builder, rules in
audit_pack_analysis, layout in app/reporting.

Issuing runs inside the request, anchor included. Unlike a driver's handshake (which
queues its anchor so nobody stands holding a swipe), issuing is a rare, deliberate
desk action where a few seconds' wait is fine — and it means the dispatcher leaves the
screen knowing whether the seal landed.
"""

import asyncio
import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import anchor_subject, compute_payload_hash
from app.blockchain.hedera import mirror_base_url
from app.core.config import settings
from app.core.exceptions import HederaServiceError, HederaTimeoutError, ResourceNotFoundError
from app.db.models.audit_packs import AuditPack, AuditPackAccessEvent
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    AnchorStatus,
    AuditPackAccessEventType,
    BlockchainReceiptType,
    SubjectType,
    enum_text,
)
from app.db.models.trips import Trip
from app.orchestration.audit_pack_builder import build_audit_manifest
from app.reporting.incident_sheet import render_incident_sheet_pdf
from app.reporting.pdf_renderer import render_audit_pack_pdf
from app.schemas.audit_pack import (
    AuditPackCreate,
    AuditPackManifest,
    AuditPackOptions,
    AuditPackRead,
    AuditPackStatus,
    PackIssue,
)
from app.schemas.people import UserRead
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError,
    download_audit_pack_pdf,
    upload_audit_pack_pdf,
)

logger = logging.getLogger(__name__)

# Bumped only if the seal's key set or meaning changes; old receipts keep verifying
# under the version they were written with.
SEAL_PAYLOAD_VERSION = 1

# 32 random bytes → 43 URL-safe characters: unguessable, and short enough to paste.
SHARE_TOKEN_BYTES = 32


@dataclass(frozen=True)
class IssuedPack:
    pack: AuditPack
    # Exists only in this return value — the database keeps its hash.
    raw_token: str


def pack_label(trip_reference: str, pack_version: int) -> str:
    return f"{trip_reference}-AP{pack_version}"


def share_url(raw_token: str) -> str:
    return f"{settings.AUDIT_PACK_PORTAL_BASE_URL.rstrip('/')}/p/{raw_token}"


def verify_url(pack_id: uuid.UUID) -> str:
    """Printed in the PDF. Carries the pack id, not the share token, so a forwarded PDF
    lets anyone check the seal without opening the evidence behind it."""
    return f"{settings.AUDIT_PACK_PORTAL_BASE_URL.rstrip('/')}/v/{pack_id}"


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def seal_payload(pack: AuditPack) -> dict[str, Any]:
    """What is hashed onto Hedera for an issued pack. Only hashes and ids — the manifest
    itself holds personal data and never leaves the database."""
    return {
        "payload_version": SEAL_PAYLOAD_VERSION,
        "pack_id": str(pack.id),
        "trip_id": str(pack.trip_id),
        "pack_version": pack.pack_version,
        "manifest_sha256": pack.manifest_sha256,
        "pdf_sha256": pack.pdf_sha256,
        "issued_at": pack.issued_at.isoformat(),
    }


def pack_status(pack: AuditPack, now: datetime) -> AuditPackStatus:
    if pack.revoked_at is not None:
        return "revoked"
    if pack.expires_at <= now:
        return "expired"
    return "active"


async def render_preview_pdf(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID, options: AuditPackOptions,
) -> tuple[AuditPackManifest, bytes]:
    """Build the manifest and render it, unissued: watermarked PREVIEW, not stored, not
    anchored. Rendering is CPU-bound (~1s), so it runs off the event loop."""
    manifest = await build_audit_manifest(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id, options=options,
    )
    pdf = await asyncio.to_thread(
        render_audit_pack_pdf, manifest, issue=None, mirror_base_url=mirror_base_url(settings.HEDERA_NETWORK),
    )
    return manifest, pdf


async def render_trip_incident_sheet(
    db: AsyncSession, *, trip_id: uuid.UUID, operator_organization_id: uuid.UUID,
) -> tuple[AuditPackManifest, bytes]:
    """The one-to-two page fact sheet for SAPS or the tracking company, built live from
    the trip. Raises NoIncidentError when the trip has no critical exception."""
    manifest = await build_audit_manifest(
        db, trip_id=trip_id, operator_organization_id=operator_organization_id, options=AuditPackOptions(),
    )
    pdf = await asyncio.to_thread(render_incident_sheet_pdf, manifest, verify_url=None)
    return manifest, pdf


async def _next_version(db: AsyncSession, trip_id: uuid.UUID) -> int:
    # Row lock on the trip serialises concurrent issues for it; the unique
    # (trip_id, pack_version) constraint is the backstop if that is ever bypassed.
    await db.execute(select(Trip.id).where(Trip.id == trip_id).with_for_update())
    current = (await db.execute(
        select(func.max(AuditPack.pack_version)).where(AuditPack.trip_id == trip_id)
    )).scalar_one()
    return (current or 0) + 1


async def _seal(db: AsyncSession, pack: AuditPack) -> None:
    """Fail-open like phase anchors: the pack is still issued if Hedera is down, but it
    says `failed`, never sealed."""
    try:
        receipt = await anchor_subject(
            db, subject_type=SubjectType.AUDIT_PACK, subject_id=pack.id, canonical_payload=seal_payload(pack),
            receipt_type=BlockchainReceiptType.AUDIT_PACK_ISSUED, trip_id=pack.trip_id,
        )
    except (HederaTimeoutError, HederaServiceError):
        logger.exception("Audit pack seal failed for pack_id=%s; issued unsealed", pack.id)
        pack.anchor_status = AnchorStatus.FAILED
        return
    pack.blockchain_receipt_id = receipt.id
    pack.anchor_status = AnchorStatus.ANCHORED


async def issue_audit_pack(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    organization_id: uuid.UUID,
    issued_by: UserRead,
    request: AuditPackCreate,
    now: datetime | None = None,
) -> IssuedPack:
    """Snapshot the trip, render and store the PDF, seal it on Hedera, mint the link.

    Raises ResourceNotFoundError (trip or consignment not this operator's) and
    EvidenceStorageUnavailableError (PDF could not be stored — nothing is issued).
    """
    now = now or datetime.now(UTC)
    manifest = await build_audit_manifest(
        db, trip_id=trip_id, operator_organization_id=organization_id, options=request.options(),
        generated_at=now,
    )
    version = await _next_version(db, trip_id)
    pack_id = uuid.uuid4()
    raw_token = secrets.token_urlsafe(SHARE_TOKEN_BYTES)
    expires_at = now + timedelta(days=request.expires_in_days)

    issue = PackIssue(
        pack_label=pack_label(manifest.trip.trip_reference, version),
        recipient_name=request.recipient_name, recipient_organization=request.recipient_organization,
        purpose=request.purpose, external_reference=request.external_reference,
        issued_by_name=issued_by.full_name, issued_at=now, expires_at=expires_at, verify_url=verify_url(pack_id),
    )
    pdf = await asyncio.to_thread(
        render_audit_pack_pdf, manifest, issue=issue, mirror_base_url=mirror_base_url(settings.HEDERA_NETWORK),
    )
    stored = await upload_audit_pack_pdf(trip_id=str(trip_id), pack_id=str(pack_id), pdf_bytes=pdf)

    manifest_json = manifest.as_json_dict()
    pack = AuditPack(
        id=pack_id, trip_id=trip_id, consignment_id=request.scope_consignment_id, organization_id=organization_id,
        pack_version=version, purpose=request.purpose, external_reference=request.external_reference,
        recipient_name=request.recipient_name, recipient_organization=request.recipient_organization,
        recipient_email=request.recipient_email, include_location_trail=request.include_location_trail,
        include_full_driver_id=request.include_full_driver_id, manifest_version=manifest.manifest_version,
        manifest_json=manifest_json, manifest_sha256=compute_payload_hash(manifest_json),
        pdf_storage_bucket=stored.s3_bucket, pdf_storage_key=stored.s3_key, pdf_sha256=stored.file_hash,
        pdf_size_bytes=len(pdf), anchor_status=AnchorStatus.PENDING, token_hash=hash_token(raw_token),
        issued_at=now, expires_at=expires_at, issued_by_user_id=issued_by.id,
    )
    db.add(pack)
    await db.flush()
    await _seal(db, pack)
    await db.flush()
    return IssuedPack(pack=pack, raw_token=raw_token)


async def get_audit_pack(db: AsyncSession, *, pack_id: uuid.UUID, organization_id: uuid.UUID) -> AuditPack:
    pack = (await db.execute(
        select(AuditPack).where(AuditPack.id == pack_id, AuditPack.organization_id == organization_id)
    )).scalar_one_or_none()
    if pack is None:
        raise ResourceNotFoundError("Audit pack", str(pack_id))
    return pack


async def revoke_audit_pack(
    db: AsyncSession, *, pack_id: uuid.UUID, organization_id: uuid.UUID, user_id: uuid.UUID,
    now: datetime | None = None,
) -> AuditPack:
    """Stop the share link. Idempotent: the first revocation's time and author stand."""
    pack = await get_audit_pack(db, pack_id=pack_id, organization_id=organization_id)
    if pack.revoked_at is None:
        pack.revoked_at = now or datetime.now(UTC)
        pack.revoked_by_user_id = user_id
        await db.flush()
    return pack


async def read_audit_packs(
    db: AsyncSession, packs: list[AuditPack], *, now: datetime | None = None,
) -> list[AuditPackRead]:
    """Enrich pack rows with label, Hedera receipt and view counts in three queries."""
    if not packs:
        return []
    now = now or datetime.now(UTC)
    ids = [p.id for p in packs]
    references = dict((await db.execute(
        select(Trip.id, Trip.trip_reference).where(Trip.id.in_({p.trip_id for p in packs}))
    )).tuples().all())
    receipt_ids = [p.blockchain_receipt_id for p in packs if p.blockchain_receipt_id is not None]
    receipts = {
        r.id: r for r in (await db.execute(
            select(BlockchainReceipt).where(BlockchainReceipt.id.in_(receipt_ids))
        )).scalars()
    } if receipt_ids else {}
    views = {
        pack_id: (count, last) for pack_id, count, last in (await db.execute(
            select(AuditPackAccessEvent.audit_pack_id, func.count(), func.max(AuditPackAccessEvent.created_at))
            .where(
                AuditPackAccessEvent.audit_pack_id.in_(ids),
                AuditPackAccessEvent.event_type == AuditPackAccessEventType.VIEWED,
            )
            .group_by(AuditPackAccessEvent.audit_pack_id)
        )).tuples()
    }

    reads: list[AuditPackRead] = []
    for pack in packs:
        receipt = receipts.get(pack.blockchain_receipt_id) if pack.blockchain_receipt_id else None
        count, last_viewed = views.get(pack.id, (0, None))
        reads.append(AuditPackRead(
            id=pack.id, pack_label=pack_label(references[pack.trip_id], pack.pack_version), trip_id=pack.trip_id,
            consignment_id=pack.consignment_id, purpose=pack.purpose, external_reference=pack.external_reference,
            recipient_name=pack.recipient_name, recipient_organization=pack.recipient_organization,
            recipient_email=pack.recipient_email, include_location_trail=pack.include_location_trail,
            include_full_driver_id=pack.include_full_driver_id, manifest_sha256=pack.manifest_sha256,
            pdf_sha256=pack.pdf_sha256, pdf_size_bytes=pack.pdf_size_bytes, anchor_status=enum_text(pack.anchor_status),
            hedera_topic_id=receipt.hedera_topic_id if receipt else None,
            hedera_sequence_number=receipt.hedera_sequence_number if receipt else None,
            hedera_tx_id=receipt.hedera_tx_id if receipt else None,
            hedera_consensus_at=receipt.hedera_consensus_timestamp if receipt else None,
            issued_at=pack.issued_at, expires_at=pack.expires_at, revoked_at=pack.revoked_at,
            status=pack_status(pack, now), view_count=count, last_viewed_at=last_viewed,
        ))
    return reads


async def list_audit_packs(
    db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID, now: datetime | None = None,
) -> list[AuditPackRead]:
    packs = list((await db.execute(
        select(AuditPack)
        .where(AuditPack.trip_id == trip_id, AuditPack.organization_id == organization_id)
        .order_by(AuditPack.pack_version.desc())
    )).scalars())
    return await read_audit_packs(db, packs, now=now)


async def list_access_events(
    db: AsyncSession, *, pack_id: uuid.UUID, organization_id: uuid.UUID,
) -> list[AuditPackAccessEvent]:
    await get_audit_pack(db, pack_id=pack_id, organization_id=organization_id)
    return list((await db.execute(
        select(AuditPackAccessEvent).where(AuditPackAccessEvent.audit_pack_id == pack_id)
        .order_by(AuditPackAccessEvent.created_at.desc())
    )).scalars())


async def download_issued_pdf(
    db: AsyncSession, *, pack_id: uuid.UUID, organization_id: uuid.UUID,
) -> tuple[str, bytes]:
    """The PDF exactly as issued, or an error — never a file whose hash has changed,
    since handing out an altered copy of evidence is worse than handing out nothing."""
    pack = await get_audit_pack(db, pack_id=pack_id, organization_id=organization_id)
    pdf = await download_audit_pack_pdf(s3_bucket=pack.pdf_storage_bucket, s3_key=pack.pdf_storage_key)
    if hashlib.sha256(pdf).hexdigest() != pack.pdf_sha256:
        logger.error("Stored audit pack PDF no longer matches its issued hash (pack_id=%s)", pack.id)
        raise EvidenceObjectIntegrityError("The stored audit pack PDF no longer matches the one issued")
    reference = (await db.execute(select(Trip.trip_reference).where(Trip.id == pack.trip_id))).scalar_one()
    return pack_label(reference, pack.pack_version), pdf
