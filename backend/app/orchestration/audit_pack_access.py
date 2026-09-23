"""The public side of an audit pack: what a share-link holder can see and do.

Every read is resolved from the link's token hash and logged, including refusals — a
dispatcher seeing views of a revoked link is exactly how a leaked link gets noticed.
Nothing here needs an account: insurers and adjusters are one-off visitors, and the
project's rule is zero-login for roles that have no account (CLAUDE.md).
"""

import asyncio
import hashlib
import logging
import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import canonicalize_payload, compute_payload_hash
from app.blockchain.hedera import HederaService, mirror_base_url
from app.core.config import settings
from app.core.exceptions import HederaServiceError, ResourceNotFoundError
from app.db.models.audit_packs import AuditPack, AuditPackAccessEvent
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import AuditPackAccessEventType, SubjectType, VerifyStatus, enum_text
from app.db.models.evidence import EvidenceArtifact
from app.db.models.phases import PhaseEvent
from app.db.models.transit import Checkpoint, TripException
from app.db.models.trips import Trip
from app.orchestration.audit_pack_service import hash_token, pack_label, seal_payload, verify_url
from app.orchestration.verification_service import verify_subject
from app.reporting.incident_sheet import render_incident_sheet_pdf
from app.schemas.audit_pack import (
    AuditPackManifest,
    LiveCheckStatus,
    LiveRecordCheck,
    LiveVerification,
    PublicAuditPackView,
    PublicPackSeal,
    SealReceipt,
)
from app.storage.supabase_storage import (
    EvidenceObjectIntegrityError,
    download_audit_pack_pdf,
    download_evidence_file,
)

logger = logging.getLogger(__name__)

# Column width of audit_pack_access_events.user_agent; longer strings are cut, not refused.
USER_AGENT_MAX_LENGTH = 400


# VerifyStatus → the public vocabulary; one table so a new status can't slip through as
# an unrecognised string on the insurer's page.
_LIVE_STATUS: dict[VerifyStatus, LiveCheckStatus] = {
    VerifyStatus.VERIFIED: "verified",
    VerifyStatus.DB_MISMATCH: "db_mismatch",
    VerifyStatus.HEDERA_MISMATCH: "hedera_mismatch",
    VerifyStatus.NO_RECEIPT: "no_receipt",
    VerifyStatus.ERROR: "error",
}


class ShareLinkClosed(Exception):
    """The token is real but the link no longer opens the pack."""

    def __init__(self, reason: Literal["expired", "revoked"]) -> None:
        super().__init__(f"Audit pack link {reason}")
        self.reason = reason


def _log(
    db: AsyncSession, pack: AuditPack, event_type: AuditPackAccessEventType,
    client_ip: str | None, user_agent: str | None,
) -> None:
    db.add(AuditPackAccessEvent(
        id=uuid.uuid4(), audit_pack_id=pack.id, event_type=event_type, client_ip=client_ip,
        user_agent=user_agent[:USER_AGENT_MAX_LENGTH] if user_agent else None,
    ))


async def open_shared_pack(
    db: AsyncSession,
    *,
    raw_token: str,
    event_type: AuditPackAccessEventType,
    client_ip: str | None,
    user_agent: str | None,
    now: datetime | None = None,
) -> AuditPack:
    """Resolve a share token to its pack and record the access.

    Raises ResourceNotFoundError for an unknown token (nothing logged — there is no pack
    to log against) and ShareLinkClosed for a revoked or expired one (logged as denied).
    """
    now = now or datetime.now(UTC)
    pack = (await db.execute(
        select(AuditPack).where(AuditPack.token_hash == hash_token(raw_token))
    )).scalar_one_or_none()
    if pack is None:
        # Never echo the token into logs or errors: it is the credential.
        raise ResourceNotFoundError("Audit pack link", "<redacted>")
    if pack.revoked_at is not None:
        _log(db, pack, AuditPackAccessEventType.DENIED_REVOKED, client_ip, user_agent)
        await db.flush()
        raise ShareLinkClosed("revoked")
    if pack.expires_at <= now:
        _log(db, pack, AuditPackAccessEventType.DENIED_EXPIRED, client_ip, user_agent)
        await db.flush()
        raise ShareLinkClosed("expired")
    _log(db, pack, event_type, client_ip, user_agent)
    await db.flush()
    return pack


async def _seal_receipt(db: AsyncSession, pack: AuditPack) -> BlockchainReceipt | None:
    if pack.blockchain_receipt_id is None:
        return None
    return (await db.execute(
        select(BlockchainReceipt).where(BlockchainReceipt.id == pack.blockchain_receipt_id)
    )).scalar_one_or_none()


async def pack_seal(db: AsyncSession, pack: AuditPack) -> PublicPackSeal:
    receipt = await _seal_receipt(db, pack)
    reference = (await db.execute(select(Trip.trip_reference).where(Trip.id == pack.trip_id))).scalar_one()
    return PublicPackSeal(
        pack_id=pack.id, pack_label=pack_label(reference, pack.pack_version), issued_at=pack.issued_at,
        expires_at=pack.expires_at, revoked=pack.revoked_at is not None,
        anchor_status=enum_text(pack.anchor_status), manifest_sha256=pack.manifest_sha256,
        pdf_sha256=pack.pdf_sha256,
        seal=SealReceipt(
            canonical_payload=canonicalize_payload(receipt.payload_json), data_hash=receipt.data_hash,
            hedera_topic_id=receipt.hedera_topic_id, hedera_sequence_number=receipt.hedera_sequence_number,
            hedera_tx_id=receipt.hedera_tx_id, hedera_consensus_at=receipt.hedera_consensus_timestamp,
        ) if receipt is not None else None,
        hedera_network=settings.HEDERA_NETWORK,
        mirror_base_url=mirror_base_url(settings.HEDERA_NETWORK),
    )


async def seal_by_pack_id(db: AsyncSession, *, pack_id: uuid.UUID) -> PublicPackSeal:
    """The seal check printed in the PDF. Deliberately needs no token and shows no trip
    content, so a forwarded PDF can be checked without exposing the evidence."""
    pack = (await db.execute(select(AuditPack).where(AuditPack.id == pack_id))).scalar_one_or_none()
    if pack is None:
        raise ResourceNotFoundError("Audit pack", str(pack_id))
    return await pack_seal(db, pack)


async def shared_view(db: AsyncSession, pack: AuditPack) -> PublicAuditPackView:
    return PublicAuditPackView(
        seal=await pack_seal(db, pack),
        recipient_name=pack.recipient_name, recipient_organization=pack.recipient_organization,
        purpose=pack.purpose, external_reference=pack.external_reference,
        manifest=AuditPackManifest.model_validate(pack.manifest_json),
    )


async def shared_pdf(pack: AuditPack) -> bytes:
    pdf = await download_audit_pack_pdf(s3_bucket=pack.pdf_storage_bucket, s3_key=pack.pdf_storage_key)
    if hashlib.sha256(pdf).hexdigest() != pack.pdf_sha256:
        logger.error("Stored audit pack PDF no longer matches its issued hash (pack_id=%s)", pack.id)
        raise EvidenceObjectIntegrityError("The stored audit pack PDF no longer matches the one issued")
    return pdf


async def shared_incident_sheet(pack: AuditPack) -> bytes:
    """Rendered from the pack's frozen manifest, so it says exactly what the issued pack
    says. Raises NoIncidentError when the snapshot holds no critical exception."""
    manifest = AuditPackManifest.model_validate(pack.manifest_json)
    return await asyncio.to_thread(render_incident_sheet_pdf, manifest, verify_url=verify_url(pack.id))


def _manifest_artifact_ids(manifest: AuditPackManifest) -> set[uuid.UUID]:
    """Only files the issuer's manifest names — a link to one pack must never become a
    way to fetch any artifact on the trip (e.g. a photo withheld by scope)."""
    files = [
        *(e for p in manifest.phases for e in p.evidence),
        *(e for c in manifest.checkpoints for e in c.evidence),
        *(e for x in manifest.exceptions for e in x.evidence),
    ]
    return {f.artifact_id for f in files}


async def shared_artifact(db: AsyncSession, pack: AuditPack, *, artifact_id: uuid.UUID) -> tuple[str, bytes]:
    manifest = AuditPackManifest.model_validate(pack.manifest_json)
    if artifact_id not in _manifest_artifact_ids(manifest):
        raise ResourceNotFoundError("Evidence artifact", str(artifact_id))
    artifact = (await db.execute(
        select(EvidenceArtifact).where(EvidenceArtifact.id == artifact_id, EvidenceArtifact.trip_id == pack.trip_id)
    )).scalar_one_or_none()
    if artifact is None:
        raise ResourceNotFoundError("Evidence artifact", str(artifact_id))
    data = await download_evidence_file(s3_bucket=artifact.s3_bucket, s3_key=artifact.s3_key)
    return artifact.mime_type, data


async def _check_seal(pack: AuditPack, receipt: BlockchainReceipt | None, hedera: HederaService) -> LiveCheckStatus:
    if receipt is None:
        return "no_receipt"
    if compute_payload_hash(seal_payload(pack)) != receipt.data_hash:
        return "db_mismatch"
    if not receipt.hedera_topic_id or not receipt.hedera_sequence_number:
        return "error"
    try:
        matched = await asyncio.to_thread(
            hedera.verify_hash, receipt.hedera_topic_id, receipt.hedera_sequence_number, receipt.data_hash,
        )
    except HederaServiceError:
        # Mirror unreachable is not tamper evidence — keep the two apart.
        return "error"
    return "verified" if matched else "hedera_mismatch"


async def _records_added_since(db: AsyncSession, pack: AuditPack) -> int:
    exceptions = select(func.count()).select_from(TripException).where(
        TripException.trip_id == pack.trip_id, TripException.created_at > pack.issued_at,
    )
    if pack.consignment_id is not None:
        # A scoped pack must not learn how many exceptions another client's cargo got.
        exceptions = exceptions.where(or_(
            TripException.consignment_id.is_(None), TripException.consignment_id == pack.consignment_id,
        ))
    checkpoints = select(func.count()).select_from(Checkpoint).where(
        Checkpoint.trip_id == pack.trip_id, Checkpoint.created_at > pack.issued_at,
    )
    phases = select(func.count()).select_from(PhaseEvent).where(
        PhaseEvent.trip_id == pack.trip_id, PhaseEvent.completed_at > pack.issued_at,
    )
    total = 0
    for query in (exceptions, checkpoints, phases):
        total += (await db.execute(query)).scalar_one()
    return total


async def verify_shared_pack(db: AsyncSession, pack: AuditPack, *, now: datetime | None = None) -> LiveVerification:
    """Re-check, against today's database and Hedera, every record the pack anchors.

    The snapshot itself never changes; this answers a different question — has anyone
    altered the live records since the pack was issued?
    """
    hedera = HederaService()
    manifest = AuditPackManifest.model_validate(pack.manifest_json)
    records: list[LiveRecordCheck] = []
    for record in manifest.anchored_records:
        outcome = await verify_subject(
            db, subject_type=SubjectType(record.subject_type), subject_id=record.subject_id, hedera_service=hedera,
        )
        records.append(LiveRecordCheck(
            receipt_id=record.receipt_id, subject_type=record.subject_type, subject_id=record.subject_id,
            status=_LIVE_STATUS[VerifyStatus(outcome.status)],
        ))
    return LiveVerification(
        checked_at=now or datetime.now(UTC),
        seal_status=await _check_seal(pack, await _seal_receipt(db, pack), hedera),
        records=records,
        records_added_since_issue=await _records_added_since(db, pack),
    )
