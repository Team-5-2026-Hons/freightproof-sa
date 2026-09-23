"""The Incident Fact Sheet: one or two pages for a SAPS detective, the tracking company or
a TAPA incident report — the facts they ask for first, with a pointer to the full pack.

Rendered from the same manifest as the full audit pack, so the two can never disagree.
"""

from pathlib import Path

from jinja2 import Environment
from weasyprint import HTML

from app.reporting.pdf_renderer import TIER_LABELS, environment
from app.schemas.audit_pack import AuditPackManifest

_TEMPLATE_NAME = "incident_sheet.html.j2"
_TEMPLATE_DIR = Path(__file__).parent / "templates"

# FreightProof exception → the TAPA incident category it most likely corresponds to.
# A SUGGESTION printed as such: classifying a crime is the reporter's call, not ours.
_TAPA_SUGGESTION: dict[str, str] = {
    "panic_button": "Hijacking / robbery (suspected)",
    "seal_broken_in_transit": "Theft from vehicle (suspected)",
    "seal_mismatch": "Theft from vehicle (suspected)",
    "parcel_count_mismatch": "Theft — shortage on delivery (suspected)",
    "waybill_count_mismatch": "Theft — shortage on delivery (suspected)",
    "route_deviation": "Suspicious circumstances",
    "driver_vehicle_separation": "Suspicious circumstances",
    "driver_location_mismatch": "Suspicious circumstances",
}


class NoIncidentError(ValueError):
    """The trip has no critical exception, so there is no incident to report."""


def suggested_tapa_category(exception_type: str) -> str | None:
    return _TAPA_SUGGESTION.get(exception_type)


def render_incident_sheet_html(manifest: AuditPackManifest, *, verify_url: str | None) -> str:
    incident = manifest.incident
    if incident is None:
        raise NoIncidentError("This trip has no critical incident to report.")
    env: Environment = environment()
    return env.get_template(_TEMPLATE_NAME).render(
        m=manifest,
        inc=incident,
        facts=manifest.latest_declared_facts(),
        tapa=suggested_tapa_category(incident.first_exception_type),
        tiers=TIER_LABELS,
        verify_url=verify_url,
        total_declared_value=sum((c.declared_value for c in manifest.consignments if c.declared_value is not None), start=0),
        css=(_TEMPLATE_DIR / "audit_pack.css").read_text(encoding="utf-8"),
    )


def render_incident_sheet_pdf(manifest: AuditPackManifest, *, verify_url: str | None) -> bytes:
    return HTML(string=render_incident_sheet_html(manifest, verify_url=verify_url)).write_pdf()
