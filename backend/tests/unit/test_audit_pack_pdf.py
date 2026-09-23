"""Unit tests for reporting/pdf_renderer.py — HTML assembly and the WeasyPrint PDF."""

import io
import uuid
from datetime import timedelta

from pypdf import PdfReader

from app.reporting.pdf_renderer import render_audit_pack_html, render_audit_pack_pdf
from app.schemas.audit_pack import AnchoredRecord, PackIssue

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
