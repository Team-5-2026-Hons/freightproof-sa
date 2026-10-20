"""Unit tests for reporting/pdf_renderer.py — HTML assembly and the WeasyPrint PDF."""

import io
import uuid
from datetime import timedelta

from pypdf import PdfReader

from app.reporting.pdf_renderer import render_audit_pack_html, render_audit_pack_pdf
from app.schemas.audit_pack import (
    AnchoredRecord, AuditPackManifest, DriverSubstitutionRecord, ExceptionAnchorRecord,
    ExceptionPhoto, HandoverDeclarationRecord, PackIssue, SubstitutionClarificationRecord,
)

from tests.unit.audit_pack_factories import T0, make_exception, make_manifest, make_phase

MIRROR = "https://testnet.mirrornode.hedera.com"


def _issue() -> PackIssue:
    return PackIssue(
        pack_label="FP-0042-AP1", recipient_name="Jane Adjuster", recipient_organization="Santam Claims",
        purpose="insurance_claim", external_reference="CLM-88123", issued_by_name="Ops Desk",
        issued_at=T0 + timedelta(days=2), expires_at=T0 + timedelta(days=32), verify_url="https://portal/p/x",
    )


def _record() -> AnchoredRecord:
    return AnchoredRecord(
        receipt_id=uuid.uuid4(), subject_type="phase_event", subject_id=uuid.uuid4(), receipt_type="pickup",
        canonical_payload='{"phase_type":"departure","seal_number":"SEAL-001"}', data_hash="ab" * 32,
        hedera_topic_id="0.0.2002", hedera_sequence_number=118, hedera_tx_id="0.0.1@1.0",
        hedera_consensus_at=T0, payload_matches_hash=True,
    )


def _text(pdf: bytes) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)


def immediate_transfer_manifest() -> AuditPackManifest:
    manifest = make_manifest(phases=[make_phase(0, "activation"), make_phase(1, "loading")])
    incoming = uuid.uuid4()
    transfer = DriverSubstitutionRecord(
        substitution_id=uuid.uuid4(), original_driver_name="Outgoing sample driver",
        substituting_driver_name="Incoming sample driver", exchange_location=None, is_planned=None,
        substitution_at=T0 + timedelta(minutes=5), anchor_receipt_id=None, tier="declared",
        sequence_number=1, completion_mode="normal", arranged_by_name="Sample dispatcher",
        request_format="immediate_v2", confirmation_policy="incoming_acceptance_v2",
        completed_by="driver", completed_by_driver_id=incoming, completed_by_name="Incoming sample driver",
        declarations=[HandoverDeclarationRecord(
            role="incoming", driver_id=incoming, driver_name="Incoming sample driver", captured_at=T0,
            received_at=T0 + timedelta(minutes=4), location_recorded=True, latitude=-30, longitude=25,
            accuracy_metres=8, location_observed_at=T0 - timedelta(minutes=1),
            location_observation_committed=True, seal_readings=["AB-1234 intact"], photo_sha256=[], discrepancy_note=None,
        )],
        corrections=[SubstitutionClarificationRecord(
            id=uuid.uuid4(), recorded_by_user_id=uuid.uuid4(), recorded_by_name="Sample reviewer",
            recorded_at=T0 + timedelta(hours=1), reason="Clarify seal", correction_note="Read at rear doors",
            event_hash="a" * 64, anchor_status="pending", receipt_id=None,
        )],
    )
    return manifest.model_copy(update={"driver": manifest.driver.model_copy(update={"substitutions": [transfer]})})


def test_immediate_transfer_pdf_names_actual_actor_and_observation_without_outgoing_declaration() -> None:
    manifest = immediate_transfer_manifest()

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)
    text = " ".join(_text(render_audit_pack_pdf(manifest, issue=None, mirror_base_url=MIRROR)).split())

    assert "Outgoing driver: Not requested — notification only" in html
    assert "Outgoing declaration" not in html
    for fact in ("Incoming sample driver", "covered by custody commitment", "Sample reviewer", "Read at rear doors"):
        assert fact in html and fact in text


def test_render_audit_pack_pdf_produces_multi_page_pdf_with_trip_reference():
    # Arrange
    manifest = make_manifest(phases=[make_phase(0, "trip_creation"), make_phase(1, "departure")])

    # Act
    pdf = render_audit_pack_pdf(manifest, issue=None, mirror_base_url=MIRROR)

    # Assert
    assert pdf.startswith(b"%PDF-")
    assert len(PdfReader(io.BytesIO(pdf)).pages) > 1
    assert "FP-0042" in _text(pdf)


def test_render_audit_pack_html_preview_is_marked_not_issued():
    # Act
    html = render_audit_pack_html(make_manifest(phases=[]), issue=None, mirror_base_url=MIRROR)

    # Assert
    assert "PREVIEW" in html
    assert "not an issued pack" in html.lower()


def test_render_audit_pack_html_issued_pack_names_recipient_and_purpose():
    # Act
    html = render_audit_pack_html(make_manifest(phases=[]), issue=_issue(), mirror_base_url=MIRROR)

    # Assert
    assert "FP-0042-AP1" in html
    assert "Jane Adjuster" in html
    assert "Santam Claims" in html
    assert "CLM-88123" in html
    assert "PREVIEW" not in html


def test_render_audit_pack_html_escapes_recorded_text():
    # Arrange
    exception = make_exception("dispatcher_note", "info", description="<script>alert(1)</script>")

    # Act
    html = render_audit_pack_html(make_manifest(phases=[], exceptions=[exception]), issue=None,
                                  mirror_base_url=MIRROR)

    # Assert
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_render_audit_pack_html_labels_every_tier():
    # Arrange
    phases = [make_phase(0, "trip_creation", tier="anchored"), make_phase(1, "loading", tier="recorded")]

    # Act
    html = render_audit_pack_html(make_manifest(phases=phases), issue=None, mirror_base_url=MIRROR)

    # Assert
    for label in ("Anchored", "Corroborated", "Recorded", "Declared"):
        assert label in html


def test_render_audit_pack_html_integrity_appendix_gives_manual_verification_steps():
    # Arrange
    manifest = make_manifest(phases=[]).model_copy(update={"anchored_records": [_record()]})

    # Act
    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    # Assert
    assert "SEAL-001" in html
    assert f"{MIRROR}/api/v1/topics/0.0.2002/messages/118" in html
    assert "SHA-256" in html


def test_render_audit_pack_html_incident_section_only_with_critical_exception():
    # Arrange
    quiet = make_manifest(phases=[], exceptions=[make_exception("dispatcher_note", "info")])
    incident = make_manifest(phases=[], exceptions=[make_exception("panic_button", "critical")])

    # Act
    quiet_html = render_audit_pack_html(quiet, issue=None, mirror_base_url=MIRROR)
    incident_html = render_audit_pack_html(incident, issue=None, mirror_base_url=MIRROR)

    # Assert
    assert 'id="incident"' not in quiet_html
    assert 'id="incident"' in incident_html


def test_render_audit_pack_html_prints_redactions_and_certificate():
    # Arrange
    manifest = make_manifest(phases=[]).model_copy(update={"redactions": ["Driver phone number withheld."]})

    # Act
    html = render_audit_pack_html(manifest, issue=_issue(), mirror_base_url=MIRROR)

    # Assert
    assert "Driver phone number withheld." in html
    assert "section 15(4)" in html
    assert "template" in html.lower()


def test_render_audit_pack_html_shows_declared_police_facts_as_declared():
    # Arrange
    from app.schemas.audit_pack import IncidentDeclarationRecord

    declaration = IncidentDeclarationRecord(
        declaration_id=uuid.uuid4(), exception_id=None, saps_station="Harrismith SAPS", saps_cas_number="123/09/2026",
        saps_officer="W/O Dlamini", reported_to_saps_at=T0 + timedelta(hours=5), tracking_company_notified_at=None,
        insurer_notified_at=None, client_notified_at=None, insurer_claim_reference="CLM-88123", note=None,
        declared_by_name="Ops Desk", declared_at=T0 + timedelta(days=1),
    )
    manifest = make_manifest(phases=[], exceptions=[make_exception("panic_button", "critical")])
    manifest = manifest.model_copy(update={"declarations": [declaration]})

    # Act
    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    # Assert
    incident = html[html.index('id="incident"'):html.index('id="plan"')]
    assert "123/09/2026" in incident
    assert "Harrismith SAPS" in incident
    assert "W/O Dlamini" in incident
    assert "tier-declared" in incident
    assert "Ops Desk" in incident


def test_render_audit_pack_html_arrival_shows_seal_condition():
    # Arrange
    manifest = make_manifest(phases=[
        make_phase(1, "departure", seal_number="SEAL-001"),
        make_phase(3, "arrival", seal_number="SEAL-001", seal_condition="damaged"),
    ])

    # Act
    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    # Assert
    assert "P3 · Arrival" in html
    assert "Seal condition" in html
    assert "<strong>Damaged</strong>" in html


def test_render_audit_pack_html_pre_arrival_phase_has_no_condition_row():
    # Arrange
    manifest = make_manifest(phases=[make_phase(3, "unloading", seal_number="SEAL-001")])

    # Act
    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    # Assert
    assert "Seal condition" not in html


# ── FP-290 Task 5: exception photos and per-action anchors ──────────────────────


def _photo(position: int, *, sha: str, tier: str = "anchored", receipt: uuid.UUID | None = None) -> ExceptionPhoto:
    return ExceptionPhoto(
        artifact_id=uuid.uuid4(), position=position, sha256=sha, mime_type="image/jpeg", captured_at=T0, tier=tier,
        anchor_event_id=uuid.uuid4() if receipt else None, anchor_receipt_id=receipt,
    )


def _anchor(action: str, *, status: str, tier: str, receipt: uuid.UUID | None = None) -> ExceptionAnchorRecord:
    return ExceptionAnchorRecord(
        event_id=uuid.uuid4(), action=action, receipt_type=f"exception_{action}", anchor_status=status,
        receipt_id=receipt, occurred_at=T0, tier=tier,
    )


def _two_photo_exception(receipt: uuid.UUID, *, tier: str = "anchored", status: str = "anchored"):
    return make_exception(
        "seal_broken_in_transit", "critical", tier=tier,
        photos=[_photo(0, sha="a1" * 32, tier=tier, receipt=receipt), _photo(1, sha="b2" * 32, tier=tier, receipt=receipt)],
        anchors=[_anchor("raised", status=status, tier=tier, receipt=receipt if status == "anchored" else None)],
    )


def test_audit_pack_html_lists_every_photo_hash_tied_to_its_receipt():
    receipt = uuid.uuid4()
    manifest = make_manifest(phases=[], exceptions=[_two_photo_exception(receipt)])

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    assert "a1" * 32 in html and "b2" * 32 in html
    assert html.count(str(receipt)) >= 3  # the raise row and both photos name the receipt


def test_audit_pack_html_shows_a_pending_raise_plainly_as_recorded_not_anchored():
    manifest = make_manifest(
        phases=[], exceptions=[_two_photo_exception(uuid.uuid4(), tier="recorded", status="pending")],
    )

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    assert "Recorded — anchoring pending" in html


def test_audit_pack_html_shows_a_failed_anchor_as_retryable_debt():
    manifest = make_manifest(
        phases=[], exceptions=[_two_photo_exception(uuid.uuid4(), tier="recorded", status="failed")],
    )

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    assert "Recorded — anchoring failed, will retry" in html


def test_audit_pack_html_counts_exception_anchors_owed_in_the_integrity_summary():
    pending = make_exception(
        "panic_button", "critical", tier="recorded", anchors=[_anchor("raised", status="pending", tier="recorded")],
    )
    failed = make_exception(
        "seal_broken_in_transit", "critical", tier="recorded",
        anchors=[_anchor("raised", status="failed", tier="recorded"), _anchor("reviewed", status="anchored", tier="anchored", receipt=uuid.uuid4())],
    )

    html = render_audit_pack_html(make_manifest(phases=[], exceptions=[pending, failed]), issue=None, mirror_base_url=MIRROR)

    assert "2 anchor(s) pending or failed" in html
    assert "no anchors owed" not in html


def test_audit_pack_html_does_not_show_an_anchored_status_as_anchored_when_the_record_changed():
    changed = make_exception(
        "panic_button", "critical", tier="recorded",
        anchors=[_anchor("raised", status="anchored", tier="recorded", receipt=uuid.uuid4())],
    )

    html = render_audit_pack_html(make_manifest(phases=[], exceptions=[changed]), issue=None, mirror_base_url=MIRROR)

    assert "Recorded — the record no longer matches its anchor" in html


def test_audit_pack_html_no_longer_says_exceptions_are_never_anchored():
    manifest = make_manifest(phases=[], exceptions=[_two_photo_exception(uuid.uuid4())])

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    assert "does not yet anchor exception" not in html


def test_audit_pack_html_states_what_an_exception_receipt_does_not_prove():
    manifest = make_manifest(phases=[], exceptions=[_two_photo_exception(uuid.uuid4())])

    html = render_audit_pack_html(manifest, issue=None, mirror_base_url=MIRROR)

    assert "does not prove" in html
    assert "location verified" not in html.lower()


def test_audit_pack_html_still_renders_a_v1_exception_with_a_single_evidence_file():
    v1 = make_exception("cargo_damage", "warning")

    html = render_audit_pack_html(make_manifest(phases=[], exceptions=[v1]), issue=None, mirror_base_url=MIRROR)

    assert "Cargo Damage" in html or "cargo damage" in html.lower()


def test_audit_pack_pdf_renders_a_two_photo_anchored_exception():
    manifest = make_manifest(phases=[], exceptions=[_two_photo_exception(uuid.uuid4())])

    pdf = render_audit_pack_pdf(manifest, issue=None, mirror_base_url=MIRROR)

    assert pdf.startswith(b"%PDF-")
    assert "Photo 2" in _text(pdf)
