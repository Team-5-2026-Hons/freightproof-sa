"""Unit tests for the Incident Fact Sheet — the 1–2 page PDF for SAPS, the tracking
company and a TAPA incident report."""

import io
import uuid
from datetime import timedelta

import pytest
from pypdf import PdfReader

from app.reporting.incident_sheet import (
    NoIncidentError,
    render_incident_sheet_html,
    render_incident_sheet_pdf,
    suggested_tapa_category,
)
from app.orchestration.audit_packs.analysis import summarise_incident
from app.schemas.audit_pack import (
    ExceptionAnchorRecord, ExceptionPhoto, IncidentDeclarationRecord, PositionFix, TripSummary, VehicleRecord,
)

from tests.unit.audit_pack_factories import T0, make_exception, make_manifest


def _vehicle(role: str, registration: str) -> VehicleRecord:
    return VehicleRecord(
        vehicle_id=uuid.uuid4(), role=role, registration=registration, vehicle_type=role, make="Volvo",
        model="FH", year=2021, vin_number="YV2RT40A5LB123456", licence_disc_expiry=None,
        licence_disc_valid_on_trip_date=None, tracker_device_id=f"PUL-{registration}",
    )


def _incident_manifest():
    panic = make_exception(
        "panic_button", "critical", raised_at=T0 + timedelta(hours=5),
        position=PositionFix(lat=-28.2726, lng=29.1294, source="driver_phone", recorded_at=T0 + timedelta(hours=5)),
    )
    manifest = make_manifest(phases=[], exceptions=[panic])
    declaration = IncidentDeclarationRecord(
        declaration_id=uuid.uuid4(), exception_id=panic.exception_id, saps_station="Harrismith SAPS",
        saps_cas_number="123/09/2026", saps_officer=None, reported_to_saps_at=T0 + timedelta(hours=6),
        tracking_company_notified_at=None, insurer_notified_at=None, client_notified_at=None,
        insurer_claim_reference=None, note=None, declared_by_name="Ops Desk", declared_at=T0 + timedelta(days=1),
    )
    return manifest.model_copy(update={
        "incident": summarise_incident([panic], fixes=[panic.position]),
        "vehicles": [_vehicle("horse", "ABC123GP"), _vehicle("trailer", "TRL456GP")],
        "declarations": [declaration],
    })


def test_suggested_tapa_category_for_panic_is_hijacking():
    assert suggested_tapa_category("panic_button") == "Hijacking / robbery (suspected)"


def test_suggested_tapa_category_broken_seal_at_arrival_is_theft_from_vehicle():
    assert suggested_tapa_category("seal_compromised") == "Theft from vehicle (suspected)"


def test_suggested_tapa_category_covers_every_critical_theft_indicator():
    # Arrange: the exception types the phase and geofence services raise as critical
    # or safety findings; each should give the reporter a starting category.
    indicators = [
        "panic_button", "seal_mismatch", "seal_compromised", "parcel_count_mismatch",
        "trailer_separated_in_transit", "trailer_location_mismatch", "moved_before_departure",
    ]

    # Act
    missing = [t for t in indicators if suggested_tapa_category(t) is None]

    # Assert
    assert missing == []


def test_suggested_tapa_category_unknown_type_is_none():
    assert suggested_tapa_category("dispatcher_note") is None


def test_incident_sheet_html_has_what_a_detective_asks_for():
    # Act
    html = render_incident_sheet_html(_incident_manifest(), verify_url="https://portal/v/pack-1")

    # Assert
    for expected in ("ABC123GP", "TRL456GP", "YV2RT40A5LB123456", "PUL-ABC123GP", "-28.27260, 29.12940",
                     "123/09/2026", "Harrismith SAPS", "Hijacking / robbery (suspected)", "https://portal/v/pack-1",
                     "*********9087"):
        assert expected in html


def test_incident_sheet_refuses_trip_without_critical_incident():
    with pytest.raises(NoIncidentError):
        render_incident_sheet_html(make_manifest(phases=[]), verify_url=None)


def test_incident_sheet_pdf_is_at_most_two_pages():
    # Act
    pdf = render_incident_sheet_pdf(_incident_manifest(), verify_url=None)

    # Assert
    assert pdf.startswith(b"%PDF-")
    assert len(PdfReader(io.BytesIO(pdf)).pages) <= 2


def test_incident_sheet_lists_each_critical_photo_hash_with_the_receipt_status():
    receipt = uuid.uuid4()
    panic = make_exception(
        "seal_broken_in_transit", "critical", tier="anchored",
        photos=[
            ExceptionPhoto(
                artifact_id=uuid.uuid4(), position=i, sha256=sha * 32, mime_type="image/jpeg", captured_at=T0,
                tier="anchored", anchor_event_id=uuid.uuid4(), anchor_receipt_id=receipt,
            )
            for i, sha in enumerate(("c3", "d4"))
        ],
        anchors=[ExceptionAnchorRecord(
            event_id=uuid.uuid4(), action="raised", receipt_type="exception_raised", anchor_status="anchored",
            receipt_id=receipt, occurred_at=T0, tier="anchored",
        )],
    )
    manifest = make_manifest(phases=[], exceptions=[panic]).model_copy(
        update={"incident": summarise_incident([panic], fixes=[])},
    )

    html = render_incident_sheet_html(manifest, verify_url=None)

    assert "c3" * 32 in html and "d4" * 32 in html
    assert str(receipt) in html
    assert "does not prove" in html


def _first_event_row(html: str) -> str:
    start = html.index("First critical event")
    return html[start:html.index("</tr>", start)]


@pytest.mark.parametrize(("tier", "label"), [("anchored", "Anchored"), ("recorded", "Recorded")])
def test_incident_sheet_summary_row_carries_the_first_critical_reports_real_tier(tier, label):
    report = make_exception("seal_broken_in_transit", "critical", tier=tier)
    manifest = make_manifest(phases=[], exceptions=[report]).model_copy(
        update={"incident": summarise_incident([report], fixes=[])},
    )

    row = _first_event_row(render_incident_sheet_html(manifest, verify_url=None))

    assert f"tier-{tier}" in row and label in row
    assert ("tier-recorded" in row) == (tier == "recorded")


def test_incident_sheet_html_names_the_order_number_when_recorded():
    # Act
    html = render_incident_sheet_html(_incident_manifest(), verify_url="https://portal/v/pack-1")

    # Assert
    assert f"order {_incident_manifest().trip.order_number}" in html


def test_incident_sheet_without_order_number_omits_the_order_fragment():
    # Arrange: a manifest-imported trip has no order number; the sheet must not print "order None".
    manifest = _incident_manifest()
    trip = TripSummary.model_validate({**manifest.trip.model_dump(), "order_number": None})
    manifest = manifest.model_copy(update={"trip": trip})

    # Act
    html = render_incident_sheet_html(manifest, verify_url="https://portal/v/pack-1")
    pdf = render_incident_sheet_pdf(manifest, verify_url="https://portal/v/pack-1")

    # Assert
    assert "order None" not in html
    assert " · order " not in html
    assert pdf.startswith(b"%PDF-")
