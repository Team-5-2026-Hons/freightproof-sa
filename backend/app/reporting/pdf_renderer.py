"""Render an Audit Pack manifest to HTML, then to PDF with WeasyPrint.

The template only lays out what the manifest already says; anything that needs working
out (gaps, incidents, observations) was decided upstream in audit_pack_analysis, so the
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

# Printed labels and one-line meanings for the four tiers — the legend on page one and
# the badge on every row read from this one table.
TIER_LABELS: dict[EvidenceTier, tuple[str, str]] = {
    "anchored": ("Anchored", "Hash recorded on the Hedera public ledger; re-verifiable by anyone."),
    "corroborated": ("Corroborated", "Independent sources agreed at the time; not anchored."),
    "recorded": ("Recorded", "FreightProof's own record, captured at the time; not anchored."),
    "declared": ("Declared", "Entered by the operator after the event."),
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
