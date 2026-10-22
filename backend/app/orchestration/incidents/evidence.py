"""The evidence a dispatcher needs to decide an incident, gathered in one place: seal readings,
counts, consignment scan totals, every exception on the trip (and which incident holds it), the
last known position and the tracking gaps.

Built from the trip's audit-pack manifest rather than its own queries, so the screen the
dispatcher decides on and the pack the insurer reads cannot disagree about a single fact.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.incidents import Incident
from app.db.models.trips import Trip
from app.orchestration.audit_packs.analysis import last_fix_before
from app.orchestration.audit_packs.builder import build_audit_manifest
from app.schemas.audit_pack import AuditPackManifest, AuditPackOptions
from app.schemas.incidents import (
    ConsignmentScanSummary,
    CountReading,
    IncidentEvidence,
    SealReading,
    TripExceptionLink,
)

_SEAL_PHOTO = "seal_photo"


def _seals(manifest: AuditPackManifest) -> list[SealReading]:
    return [
        SealReading(
            phase_event_id=p.phase_event_id, phase_type=p.phase_type, precinct_name=p.precinct_name,
            seal_number=p.seal_number, seal_condition=p.seal_condition, completed_at=p.completed_at,
            photo_ids=[e.artifact_id for e in p.evidence if e.role == _SEAL_PHOTO],
        )
        for p in manifest.phases if p.seal_number is not None or p.seal_condition is not None
    ]


def _counts(manifest: AuditPackManifest) -> list[CountReading]:
    return [
        CountReading(
            phase_event_id=p.phase_event_id, phase_type=p.phase_type, precinct_name=p.precinct_name,
            parcel_count_origin=p.parcel_count_origin, parcel_count_destination=p.parcel_count_destination,
            driver_visual_count=p.driver_visual_count,
        )
        for p in manifest.phases
        if p.parcel_count_origin is not None or p.parcel_count_destination is not None or p.driver_visual_count is not None
    ]


def _consignments(manifest: AuditPackManifest) -> list[ConsignmentScanSummary]:
    return [
        ConsignmentScanSummary(
            consignment_id=c.consignment_id, reference=c.parcel_perfect_reference,
            parcel_count_expected=c.parcel_count_expected, parcels_on_record=len(c.parcels),
            scanned_out=sum(1 for p in c.parcels if p.pp_scan_out_at is not None),
            scanned_in=sum(1 for p in c.parcels if p.pp_scan_in_at is not None),
            no_scan_in_recorded=sum(1 for p in c.parcels if p.pp_scan_out_at is not None and p.pp_scan_in_at is None),
        )
        for c in manifest.consignments
    ]


async def get_incident_evidence(
    db: AsyncSession, *, incident_id: uuid.UUID, organization_id: uuid.UUID,
) -> IncidentEvidence:
    row = (await db.execute(
        select(Incident, Trip).join(Trip, Trip.id == Incident.trip_id)
        .where(Incident.id == incident_id, Trip.operator_organization_id == organization_id)
    )).tuples().one_or_none()
    if row is None:
        raise ResourceNotFoundError("Incident", str(incident_id))
    incident, trip = row
    # The dispatcher's own operator data, so the trail is included; nothing here leaves the
    # organisation (an issued pack makes its own POPIA choices).
    manifest = await build_audit_manifest(
        db, trip_id=trip.id, operator_organization_id=organization_id,
        options=AuditPackOptions(include_location_trail=True, include_full_driver_id=False),
    )
    # Which incident holds each exception comes from the investigations the manifest already
    # loaded. This pack is unscoped, so none is cut, and an exception belongs to at most one
    # incident (uq_incident_exceptions_exception): the same map the table would give.
    holders = {
        exception_id: record.incident_id
        for record in manifest.investigations for exception_id in record.exception_ids
    }
    reference_time = incident.reported_occurred_at or incident.received_at
    return IncidentEvidence(
        incident_id=incident.id, seals=_seals(manifest), counts=_counts(manifest),
        consignments=_consignments(manifest),
        trip_exceptions=[
            TripExceptionLink(
                exception_id=e.exception_id, exception_type=e.exception_type, severity=e.severity,
                description=e.description, raised_at=e.raised_at, review_status=e.review_status,
                incident_id=holders.get(e.exception_id),
            )
            for e in manifest.exceptions
        ],
        last_known_position=last_fix_before(manifest.location_trail, reference_time),
        position_reference_time=reference_time, coverage_gaps=list(manifest.location_coverage.gaps),
        observations=list(manifest.observations),
    )
