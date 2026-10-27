"""Render an Audit Pack manifest to HTML, then to PDF with WeasyPrint.

The template only lays out what the manifest already says; anything that needs working
out (gaps, incidents, observations) was decided upstream in audit_packs.analysis, so the
PDF and the web page can never compute two different answers.

Autoescaping is on for every value: descriptions, notes and names are free text typed
by drivers and dispatchers, and must print as text, never as markup.
"""

from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from app.core.display import format_sast
from app.reporting.route_svg import render_route_svg
from app.schemas.audit_pack import AuditPackManifest, EvidenceTier, PackIssue

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_TEMPLATE_NAME = "audit_pack.html.j2"

TIER_LABELS: dict[EvidenceTier, tuple[str, str]] = {
    "anchored": ("Anchored", "Hash recorded on the Hedera public ledger; re-verifiable by anyone."),
    "corroborated": ("Corroborated", "Independent sources agreed at the time; not anchored."),
    "recorded": ("Recorded", "FreightProof's own record, captured at the time; not anchored."),
    "declared": ("Declared", "Entered by the operator after the event."),
}

RECEIPT_LABELS: dict[str, str] = {
    "journey_lock": "Trip plan locked when the trip was created",
    "activation": "Driver started the trip",
    "loading": "Loading completed",
    "pickup": "Departure handover: seal and waybill",
    "transit_arrival": "Arrival at a stop",
    "arrival_inspection": "Arrival inspection of the seal",
    "unloading": "Unloading completed",
    "delivery": "Delivery confirmed",
    "phase_override": "Dispatcher override of a phase",
    "checkpoint_batch": "Checkpoints on the road",
    "exception_batch": "Exceptions raised",
    "exception_raised": "Exception reported",
    "exception_reviewed": "Exception reviewed by a dispatcher",
    "trip_cancelled": "Trip cancelled",
    "driver_substitution": "Driver handover",
    "driver_substitution_corrected": "Correction to a driver handover",
    "vehicle_created": "Vehicle record created",
    "vehicle_updated": "Vehicle record changed",
    "driver_created": "Driver record created",
    "driver_updated": "Driver record changed",
    "precinct_created": "Depot boundary created",
    "precinct_updated": "Depot boundary changed",
    "audit_pack_issued": "This pack's seal",
}

PURPOSE_LABELS: dict[str, str] = {
    "insurance_claim": "Insurance claim",
    "delivery_dispute": "Delivery dispute",
    "police_report": "Police report",
    "client_audit": "Client audit",
    "sla_evidence": "SLA evidence",
}

_CRITICAL = "critical"


def _sast(value: datetime | None) -> str:
    return format_sast(value) if value is not None else "—"


def _humanise(value: str | None) -> str:
    return value.replace("_", " ").capitalize() if value else "—"


def receipt_label(receipt_type: str, subject_type: str) -> str:
    """A plain name for a receipt; a type added after RECEIPT_LABELS falls back to the system's wording."""
    return RECEIPT_LABELS.get(receipt_type) or f"{_humanise(receipt_type)} · {_humanise(subject_type)}"


def environment() -> Environment:
    """The shared Jinja environment — autoescaping and the SAST/label filters every
    audit-pack document uses."""
    return _ENV


def _build_environment() -> Environment:
    env = Environment(
        loader=FileSystemLoader(_TEMPLATE_DIR),
        autoescape=select_autoescape(["html", "j2"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["sast"] = _sast
    env.filters["humanise"] = _humanise
    env.globals["receipt_label"] = receipt_label
    return env


_ENV = _build_environment()


def mirror_message_url(mirror_base_url: str, topic_id: str | None, sequence: int | None) -> str | None:
    """Where anyone can read the anchored message back from Hedera, no account needed."""
    if not topic_id or sequence is None:
        return None
    return f"{mirror_base_url.rstrip('/')}/api/v1/topics/{topic_id}/messages/{sequence}"


def render_audit_pack_html(
    manifest: AuditPackManifest, *, issue: PackIssue | None, mirror_base_url: str,
) -> str:
    critical = [e for e in manifest.exceptions if e.severity == _CRITICAL]
    exception_numbers = {e.exception_id: i for i, e in enumerate(manifest.exceptions, start=1)}
    anchored = list(manifest.anchored_records)
    return _ENV.get_template(_TEMPLATE_NAME).render(
        m=manifest,
        issue=issue,
        purpose_label=PURPOSE_LABELS.get(issue.purpose, issue.purpose) if issue else None,
        tiers=TIER_LABELS,
        critical=critical,
        exception_numbers=exception_numbers,
        anchored=anchored,
        mirror_urls={r.receipt_id: mirror_message_url(mirror_base_url, r.hedera_topic_id, r.hedera_sequence_number)
                     for r in anchored},
        route_svg=render_route_svg(manifest),
        css=(_TEMPLATE_DIR / "audit_pack.css").read_text(encoding="utf-8"),
    )


def render_audit_pack_pdf(
    manifest: AuditPackManifest, *, issue: PackIssue | None, mirror_base_url: str,
) -> bytes:
    html = render_audit_pack_html(manifest, issue=issue, mirror_base_url=mirror_base_url)
    return HTML(string=html).write_pdf()
