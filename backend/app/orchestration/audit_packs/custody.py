"""The custody chain and late evidence in an audit pack (FP-83 C7).

Loaded once with the trip graph, assembled by pure functions. What an adjuster must be able to
tell apart is kept apart: who arranged a handover, each driver's own declaration, what
triggered completion, and the admin who attested an unavailable identity. The incoming driver's
identity is the status observed at completion, never the original driver's trip-level check and
never relabelled verified by an attestation.

Order is the chain's sequence number, never a timestamp (a device time can contradict the
server's order). Genuine legacy rows keep what they recorded and nothing is invented for them.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.driver_substitutions import (
    DriverSubstitutionConfirmation, DriverSubstitutionConfirmationArtifact, DriverSubstitutionRequest,
    LateDriverEvidence, LateDriverEvidenceArtifact,
)
from app.db.models.evidence import EvidenceArtifact
from app.db.models.people import Driver, User
from app.db.models.trips import DriverSubstitution
from app.schemas.audit_pack import (
    DriverSubstitutionRecord, EvidenceTier, HandoverDeclarationRecord, LateEvidenceRecord,
)


@dataclass(frozen=True)
class CustodyFacts:
    requests: dict[uuid.UUID, DriverSubstitutionRequest] = field(default_factory=dict)
    confirmations: dict[uuid.UUID, list[DriverSubstitutionConfirmation]] = field(default_factory=dict)
    photo_hashes: dict[uuid.UUID, list[str]] = field(default_factory=dict)
    late: list[LateDriverEvidence] = field(default_factory=list)
    late_photo_hashes: dict[uuid.UUID, list[str]] = field(default_factory=dict)
    users: dict[uuid.UUID, User] = field(default_factory=dict)


def _grouped(rows: Sequence[tuple[uuid.UUID, str]]) -> dict[uuid.UUID, list[str]]:
    out: dict[uuid.UUID, list[str]] = {}
    for owner, file_hash in rows:
        out.setdefault(owner, []).append(file_hash)
    return out


async def _capture_photo_hashes(db: AsyncSession, confirmation_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    link = DriverSubstitutionConfirmationArtifact
    rows = (await db.execute(
        select(link.confirmation_id, EvidenceArtifact.file_hash)
        .join(EvidenceArtifact, EvidenceArtifact.id == link.artifact_id)
        .where(link.confirmation_id.in_(confirmation_ids)).order_by(link.confirmation_id, link.position)
    )).tuples().all() if confirmation_ids else []
    return _grouped(rows)


async def _late_photo_hashes(db: AsyncSession, evidence_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    link = LateDriverEvidenceArtifact
    rows = (await db.execute(
        select(link.late_evidence_id, EvidenceArtifact.file_hash)
        .join(EvidenceArtifact, EvidenceArtifact.id == link.artifact_id)
        .where(link.late_evidence_id.in_(evidence_ids)).order_by(link.late_evidence_id, link.position)
    )).tuples().all() if evidence_ids else []
    return _grouped(rows)


async def load_custody_facts(
    db: AsyncSession, *, trip_id: uuid.UUID, substitutions: Sequence[DriverSubstitution],
) -> CustodyFacts:
    request_ids = [s.request_id for s in substitutions if s.request_id is not None]
    requests = {r.id: r for r in (await db.execute(
        select(DriverSubstitutionRequest).where(DriverSubstitutionRequest.id.in_(request_ids))
    )).scalars()} if request_ids else {}
    confirmations: dict[uuid.UUID, list[DriverSubstitutionConfirmation]] = {}
    for row in (await db.execute(
        select(DriverSubstitutionConfirmation).where(DriverSubstitutionConfirmation.request_id.in_(request_ids))
        .order_by(DriverSubstitutionConfirmation.role.desc())
    )).scalars() if request_ids else []:
        confirmations.setdefault(row.request_id, []).append(row)
    late = list((await db.execute(
        select(LateDriverEvidence).where(LateDriverEvidence.trip_id == trip_id)
        .order_by(LateDriverEvidence.received_at, LateDriverEvidence.id)
    )).scalars())
    user_ids = {r.arranged_by_user_id for r in requests.values()} | {
        s.identity_attested_by_user_id for s in substitutions if s.identity_attested_by_user_id is not None
    }
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    return CustodyFacts(
        requests=requests, confirmations=confirmations,
        photo_hashes=await _capture_photo_hashes(db, [c.id for rows in confirmations.values() for c in rows]),
        late=late,
        late_photo_hashes=await _late_photo_hashes(db, [e.id for e in late]),
        users=users,
    )


def _seal_reading(check: dict[str, object]) -> str:
    number = check.get("seal_number") or "no number"
    return f"{check.get('vehicle_id')}: {check.get('condition')} ({number})"


def _declarations(
    facts: CustodyFacts, request_id: uuid.UUID | None, drivers: dict[uuid.UUID, Driver],
) -> list[HandoverDeclarationRecord]:
    if request_id is None:
        return []
    return [
        HandoverDeclarationRecord(
            role=row.role, driver_name=drivers[row.driver_id].full_name if row.driver_id in drivers else "Unknown driver",
            captured_at=row.captured_at, received_at=row.received_at, location_recorded=row.latitude is not None,
            seal_readings=[_seal_reading(check) for check in row.seal_checks],
            photo_sha256=facts.photo_hashes.get(row.id, []), discrepancy_note=row.discrepancy_note,
        )
        for row in facts.confirmations.get(request_id, [])
    ]


def _name(users: dict[uuid.UUID, User], user_id: uuid.UUID | None) -> str | None:
    return None if user_id is None or user_id not in users else users[user_id].full_name


def substitution_records(
    substitutions: Sequence[DriverSubstitution], facts: CustodyFacts, drivers: dict[uuid.UUID, Driver],
) -> list[DriverSubstitutionRecord]:
    """One record per completed amendment, in sequence order."""
    records: list[DriverSubstitutionRecord] = []
    for s in sorted(substitutions, key=lambda row: row.sequence_number):
        request = facts.requests.get(s.request_id) if s.request_id is not None else None
        tier: EvidenceTier = "anchored" if s.blockchain_receipt_id is not None else "recorded"
        records.append(DriverSubstitutionRecord(
            substitution_id=s.id,
            original_driver_name=drivers[s.original_driver_id].full_name,
            substituting_driver_name=drivers[s.substituting_driver_id].full_name,
            exchange_location=s.exchange_location, is_planned=s.is_planned, substitution_at=s.substitution_at,
            anchor_receipt_id=s.blockchain_receipt_id, tier=tier, sequence_number=s.sequence_number,
            completion_mode=s.completion_mode,
            arranged_by_name=_name(facts.users, request.arranged_by_user_id) if request else None,
            completed_by="driver" if s.completed_by_driver_id else "dispatcher" if s.completed_by_user_id else None,
            missing_confirmation_reason=s.missing_confirmation_reason,
            incoming_identity_status=s.incoming_identity_status,
            identity_attested_by_name=_name(facts.users, s.identity_attested_by_user_id),
            identity_attested_at=s.identity_attested_at,
            incoming_licence_expiry=s.incoming_licence_expiry.isoformat() if s.incoming_licence_expiry else None,
            commitment_sha256=s.event_hash, declarations=_declarations(facts, s.request_id, drivers),
        ))
    return records


def late_evidence_records(facts: CustodyFacts, drivers: dict[uuid.UUID, Driver]) -> list[LateEvidenceRecord]:
    return [
        LateEvidenceRecord(
            evidence_id=e.id, driver_name=drivers[e.driver_id].full_name if e.driver_id in drivers else "Unknown driver",
            custody_sequence=e.custody_sequence, kind=e.kind, captured_at=e.captured_at, received_at=e.received_at,
            status=e.status, payload_sha256=e.payload_sha256, photo_sha256=facts.late_photo_hashes.get(e.id, []),
            reviewed_at=e.reviewed_at,
        )
        for e in facts.late
    ]
