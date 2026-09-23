"""Integration tests for orchestration/audit_pack_builder.build_audit_manifest,
against the realistic trip in tests/integration/audit_pack_seed.py."""

import hashlib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.anchor_service import canonicalize_payload
from app.core.exceptions import ResourceNotFoundError
from app.db.models.enums import TripStatus
from app.orchestration.audit_pack_builder import build_audit_manifest
from app.schemas.audit_pack import AuditPackManifest, AuditPackOptions

from tests.integration.audit_pack_seed import T0, AuditTrip, seed_audit_trip


@pytest.fixture
async def audit_trip(db_session: AsyncSession) -> AuditTrip:
    return await seed_audit_trip(db_session)


async def _build(db: AsyncSession, seed: AuditTrip, **options: object) -> AuditPackManifest:
    return await build_audit_manifest(
        db, trip_id=seed.trip.id, operator_organization_id=seed.org.id,
        options=AuditPackOptions(**options), generated_at=T0 + timedelta(days=1),
    )


async def test_build_audit_manifest_lists_phases_in_ledger_order(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert [p.sequence_number for p in manifest.phases] == [0, 1, 2, 3, 4, 5, 6]
    assert manifest.trip.trip_reference == "FP-AUDIT"
    assert manifest.trip.operator_name == "Load Factor"
    assert sorted(manifest.trip.client_names) == ["Courier Guy", "FedEx"]


async def test_build_audit_manifest_marks_anchored_departure_and_its_photo(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    departure = next(p for p in manifest.phases if p.phase_type == "departure")
    assert departure.tier == "anchored"
    assert departure.anchor_receipt_id == audit_trip.departure_receipt.id
    seal = next(e for e in departure.evidence if e.role == "seal_photo")
    assert seal.tier == "anchored"
    assert seal.sha256 == audit_trip.seal_photo.file_hash
    assert {f.name: f.matches_anchor for f in departure.anchored_fields}["seal_number"] is True


async def test_build_audit_manifest_unanchored_phase_evidence_is_recorded(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    loading = next(p for p in manifest.phases if p.phase_type == "loading")
    assert loading.tier == "recorded"
    assert loading.anchored_fields == []


async def test_build_audit_manifest_canonical_strings_hash_to_receipts(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert len(manifest.anchored_records) == 3
    for record in manifest.anchored_records:
        assert hashlib.sha256(record.canonical_payload.encode()).hexdigest() == record.data_hash
        assert record.payload_matches_hash is True


async def test_build_audit_manifest_flags_receipt_payload_edited_after_anchoring(db_session, audit_trip):
    # Arrange: someone rewrote the stored payload but not the anchored hash.
    receipt = audit_trip.departure_receipt
    receipt.payload_json = {**receipt.payload_json, "seal_number": "FORGED"}
    await db_session.flush()

    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    record = next(r for r in manifest.anchored_records if r.receipt_id == receipt.id)
    assert record.payload_matches_hash is False
    assert record.canonical_payload == canonicalize_payload(receipt.payload_json)
    assert any(o.code == "anchors.receipt_integrity" for o in manifest.observations)


async def test_build_audit_manifest_flags_phase_value_changed_after_anchoring(db_session, audit_trip):
    # Arrange
    audit_trip.departure.seal_number = "SEAL-999"
    await db_session.flush()

    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    departure = next(p for p in manifest.phases if p.phase_type == "departure")
    assert {f.name: f.matches_anchor for f in departure.anchored_fields}["seal_number"] is False
    assert any(o.code == "anchors.field_mismatch" for o in manifest.observations)


async def test_build_audit_manifest_masks_driver_id_by_default(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert manifest.driver.id_number == "*********9087"
    assert manifest.driver.id_number_masked is True
    assert manifest.driver.license_valid_on_trip_date is True


async def test_build_audit_manifest_full_driver_id_only_when_opted_in(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip, include_full_driver_id=True)

    # Assert
    assert manifest.driver.id_number == "8001015009087"
    assert manifest.driver.id_number_masked is False


async def test_build_audit_manifest_never_includes_driver_phone_number(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip, include_full_driver_id=True)

    # Assert
    assert audit_trip.driver.phone_number not in manifest.model_dump_json()


async def test_build_audit_manifest_reports_expired_trailer_disc(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    trailer = next(v for v in manifest.vehicles if v.role == "trailer")
    assert trailer.licence_disc_valid_on_trip_date is False


async def test_build_audit_manifest_includes_trail_gap_and_reviewed_panic(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert manifest.location_coverage.fix_counts["driver_phone"] >= 11
    assert any(g.minutes == 47 for g in manifest.location_coverage.gaps)
    panic = next(e for e in manifest.exceptions if e.exception_type == "panic_button")
    assert panic.reviewer_name == "Ops Desk"
    assert panic.position is not None
    codes = {o.code for o in manifest.observations}
    assert {"custody.completeness", "seal.continuity", "exceptions.response", "location.gap"} <= codes


async def test_build_audit_manifest_records_vehicle_change_during_trip(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    change = next(c for c in manifest.record_changes if c.subject == "vehicle")
    assert change.changed_fields == ["registration"]
    assert change.tier == "recorded"


async def test_build_audit_manifest_without_trail_withholds_positions(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip, include_location_trail=False)

    # Assert
    assert manifest.location_trail == []
    assert manifest.location_coverage.stationary_periods == []
    assert any("location trail" in r.lower() for r in manifest.redactions)


async def test_build_audit_manifest_consignment_scope_removes_other_client(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip, scope_consignment_id=audit_trip.consignment_a.id)

    # Assert
    dumped = manifest.model_dump_json()
    assert [c.parcel_perfect_reference for c in manifest.consignments] == ["WAY-A"]
    assert manifest.trip.client_names == ["FedEx"]
    assert audit_trip.scoped_mismatch.id not in {e.exception_id for e in manifest.exceptions}
    assert audit_trip.panic.id in {e.exception_id for e in manifest.exceptions}
    assert "Courier Guy" not in dumped
    assert "WAY-B" not in dumped
    assert "1 Church St" not in dumped
    pmb = next(s for s in manifest.stops if s.trip_stop_id == audit_trip.stop_pmb.id)
    assert pmb.precinct_name == "Other stop on route"
    assert manifest.redactions


async def test_build_audit_manifest_consignment_not_on_trip_raises(db_session, audit_trip):
    # Act / Assert
    with pytest.raises(ResourceNotFoundError):
        await _build(db_session, audit_trip, scope_consignment_id=uuid.uuid4())


async def test_build_audit_manifest_other_org_trip_raises(db_session, audit_trip):
    # Act / Assert
    with pytest.raises(ResourceNotFoundError):
        await build_audit_manifest(
            db_session, trip_id=audit_trip.trip.id, operator_organization_id=uuid.uuid4(),
            options=AuditPackOptions(),
        )


async def test_build_audit_manifest_unfinished_trip_is_buildable(db_session, audit_trip):
    # Arrange: the hijack case — trip held, later phases never completed.
    audit_trip.trip.status = TripStatus.EXCEPTION_HOLD
    audit_trip.trip.closed_at = None
    await db_session.flush()

    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert manifest.trip.status == "exception_hold"
    assert manifest.location_coverage.window_end == T0 + timedelta(days=1)


async def test_build_audit_manifest_summarises_the_critical_incident(db_session, audit_trip):
    # Act
    manifest = await _build(db_session, audit_trip)

    # Assert
    assert manifest.incident is not None
    assert manifest.incident.exception_ids == [audit_trip.panic.id]
    assert manifest.incident.minutes_to_first_review == 6
    assert manifest.incident.last_known_position is not None
