"""Wire contract for an Audit Pack manifest — the frozen snapshot of one trip (or one
consignment on it) that the insurer-facing PDF and web page are both rendered from.

One manifest, several renderings: if the PDF and the page each read the database
themselves they could disagree, and a claims document that says two things is worse
than none. Everything a rendering shows must therefore be in here.

Every fact carries an EvidenceTier so no rendering can imply an unanchored record is
chain-verified (FP-161 review: "avoid exporting a polished document that implies every
included fact is chain-verified"). Pure module: no DB, no HTTP.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, StringConstraints, model_validator

from app.schemas.action_location import ActionLocationAssessment
from app.schemas.text import REFERENCE_MAX_LENGTH, FreeText, clean_text

# Bumped whenever a field is added, removed or changes meaning — an issued pack is
# evidence, so a reader must be able to tell which contract it was written under.
AUDIT_PACK_MANIFEST_VERSION = 1

# anchored:     its hash is on Hedera (field-level where the anchored payload names it)
# corroborated: independent sources agreed at capture time, but nothing is anchored
# recorded:     FreightProof's own database record, captured at the time, not anchored
# declared:     typed in by the operator after the event
EvidenceTier = Literal["anchored", "corroborated", "recorded", "declared"]

PositionSource = Literal["driver_phone", "vehicle_tracker", "trailer_tracker"]

EvidenceRole = Literal[
    "seal_photo", "waybill_photo", "gate_photo", "pod_photo", "pod_signature",
    "linehaul_photo", "checkpoint_selfie", "checkpoint_cargo_photo", "exception_supporting",
]

ObservationLevel = Literal["info", "attention"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class AuditPackOptions(_Frozen):
    """What the issuer chose to include — POPIA minimality is decided per pack."""

    scope_consignment_id: UUID | None = None
    include_location_trail: bool = True
    include_full_driver_id: bool = False


class PositionFix(_Frozen):
    lat: float
    lng: float
    source: PositionSource
    recorded_at: datetime | None = None
    accuracy_metres: float | None = None


class AnchoredRecord(_Frozen):
    """One Hedera receipt plus the exact canonical string that was hashed, so a
    verifier can hash that string itself instead of trusting our serialisation."""

    receipt_id: UUID
    subject_type: str
    subject_id: UUID
    receipt_type: str
    canonical_payload: str
    data_hash: str
    hedera_topic_id: str | None
    hedera_sequence_number: int | None
    hedera_tx_id: str | None
    hedera_consensus_at: datetime | None
    # False when the stored payload no longer hashes to the stored data_hash — our own
    # receipt row was altered after anchoring, which the pack must say out loud.
    payload_matches_hash: bool


class EvidenceFile(_Frozen):
    artifact_id: UUID
    role: EvidenceRole
    sha256: str
    mime_type: str
    captured_at: datetime
    tier: EvidenceTier


class StopRecord(_Frozen):
    trip_stop_id: UUID
    sequence: int
    precinct_id: UUID
    precinct_name: str
    address: str | None
    lat: float
    lng: float
    geofence_radius_metres: int
    slot_time: datetime | None


class VehicleRecord(_Frozen):
    vehicle_id: UUID
    role: Literal["horse", "trailer"]
    registration: str
    vehicle_type: str
    make: str | None
    model: str | None
    year: int | None
    vin_number: str | None
    licence_disc_expiry: str | None
    licence_disc_valid_on_trip_date: bool | None
    tracker_device_id: str


class DriverSubstitutionRecord(_Frozen):
    substitution_id: UUID
    original_driver_name: str
    substituting_driver_name: str
    exchange_location: str
    is_planned: bool
    substitution_at: datetime
    anchor_receipt_id: UUID | None
    tier: EvidenceTier


class DriverRecord(_Frozen):
    driver_id: UUID
    full_name: str
    # Masked unless the issuer opted in — an insurer claim form asks for it, but
    # nobody else in the chain needs a full SA ID number.
    id_number: str
    id_number_masked: bool
    license_number: str
    license_expiry: str | None
    license_valid_on_trip_date: bool | None
    trip_idvs_status: str
    trip_idvs_checked_at: datetime | None
    substitutions: list[DriverSubstitutionRecord]


class ParcelRecord(_Frozen):
    barcode: str
    status: str
    pp_scan_out_at: datetime | None
    pp_scan_in_at: datetime | None


class ConsignmentRecord(_Frozen):
    consignment_id: UUID
    parcel_perfect_reference: str
    client_name: str | None
    declared_value: Decimal | None
    parcel_count_expected: int | None
    unit_count_expected: int | None
    pickup_stop_id: UUID | None
    delivery_stop_id: UUID | None
    parcels: list[ParcelRecord]


class AnchoredField(_Frozen):
    """A phase value checked against the payload its receipt committed."""

    name: str
    value: str | int | None
    matches_anchor: bool


class PhaseRecord(_Frozen):
    phase_event_id: UUID
    sequence_number: int
    phase_type: str
    status: str
    anchor_status: str
    trip_stop_id: UUID | None
    precinct_name: str | None
    slot_time: datetime | None
    completed_at: datetime | None
    driver_captured_at: datetime | None
    driver_phone: PositionFix | None
    vehicle_tracker: PositionFix | None
    trailer_fixes: list[PositionFix]
    location_assessment: ActionLocationAssessment | None
    location_warning_acknowledged_at: datetime | None
    location_warning_reason: str | None
    overridden_by_dispatcher: bool
    override_note: str | None
    seal_number: str | None
    parcel_count_origin: int | None
    parcel_count_destination: int | None
    driver_visual_count: int | None
    evidence: list[EvidenceFile]
    anchored_fields: list[AnchoredField]
    anchor_receipt_id: UUID | None
    tier: EvidenceTier


class CheckpointRecord(_Frozen):
    checkpoint_id: UUID
    checkpoint_type: str
    recorded_at: datetime
    driver_phone: PositionFix | None
    vehicle_tracker: PositionFix | None
    is_deviation: bool
    note: str | None
    evidence: list[EvidenceFile]
    tier: EvidenceTier


class ExceptionRecord(_Frozen):
    exception_id: UUID
    exception_type: str
    source: str
    severity: str
    description: str
    raised_at: datetime
    position: PositionFix | None
    phase_event_id: UUID | None
    checkpoint_id: UUID | None
    consignment_id: UUID | None
    review_status: str
    review_outcome: str | None
    reviewed_at: datetime | None
    reviewer_name: str | None
    contact_method: str | None
    review_note: str | None
    evidence: list[EvidenceFile]
    tier: EvidenceTier


class RecordChange(_Frozen):
    """A driver or vehicle master-record edit made while the trip was running —
    adjusters read these as possible collusion signals."""

    subject: Literal["driver", "vehicle"]
    subject_id: UUID
    event_type: str
    changed_fields: list[str]
    changed_at: datetime
    anchor_receipt_id: UUID | None
    tier: EvidenceTier


class CoverageGap(_Frozen):
    start: datetime
    end: datetime
    minutes: int


class StationaryPeriod(_Frozen):
    start: datetime
    end: datetime
    minutes: int
    lat: float
    lng: float


class LocationCoverage(_Frozen):
    window_start: datetime | None
    window_end: datetime | None
    fix_counts: dict[PositionSource, int]
    first_fix_at: datetime | None
    last_fix_at: datetime | None
    gaps: list[CoverageGap]
    stationary_periods: list[StationaryPeriod]


class Observation(_Frozen):
    """A factual, rule-generated sentence. States what the record shows, never a
    conclusion about fault — FreightProof records, it does not adjudicate."""

    code: str
    level: ObservationLevel
    text: str
    evidence_ids: list[UUID]


class IncidentDeclarationRecord(_Frozen):
    """Police and notification facts the operator typed in after the event. Always the
    Declared tier: FreightProof did not capture any of it, so the pack never presents it
    as if it had."""

    declaration_id: UUID
    exception_id: UUID | None
    saps_station: str | None
    saps_cas_number: str | None
    saps_officer: str | None
    reported_to_saps_at: datetime | None
    tracking_company_notified_at: datetime | None
    insurer_notified_at: datetime | None
    client_notified_at: datetime | None
    insurer_claim_reference: str | None
    note: str | None
    declared_by_name: str | None
    declared_at: datetime
    tier: Literal["declared"] = "declared"


class IncidentSummary(_Frozen):
    """The key times an adjuster or detective reads first, derived from the critical
    exceptions. Built only when the trip has at least one."""

    exception_ids: list[UUID]
    first_exception_type: str
    first_raised_at: datetime
    position: PositionFix | None
    # Last fix from ANY source at or before the first critical exception — the "last
    # known location" field on a SAPS docket and a claim form.
    last_known_position: PositionFix | None
    first_reviewed_at: datetime | None
    minutes_to_first_review: int | None


class TripSummary(_Frozen):
    trip_id: UUID
    trip_reference: str
    order_number: str
    trip_type: str
    status: str
    operator_name: str
    client_names: list[str]
    pulsit_trip_reference_id: str | None
    journey_lock_hash: str | None
    created_at: datetime
    planned_departure_at: datetime | None
    planned_arrival_at: datetime | None
    actual_departure_at: datetime | None
    actual_arrival_at: datetime | None
    closed_at: datetime | None


class AuditPackManifest(_Frozen):
    manifest_version: int = AUDIT_PACK_MANIFEST_VERSION
    generated_at: datetime
    options: AuditPackOptions
    trip: TripSummary
    stops: list[StopRecord]
    vehicles: list[VehicleRecord]
    driver: DriverRecord
    consignments: list[ConsignmentRecord]
    phases: list[PhaseRecord]
    checkpoints: list[CheckpointRecord]
    exceptions: list[ExceptionRecord]
    record_changes: list[RecordChange]
    location_trail: list[PositionFix]
    location_coverage: LocationCoverage
    anchored_records: list[AnchoredRecord]
    incident: IncidentSummary | None = None
    # Defaulted so manifests issued before declarations existed still validate.
    declarations: list[IncidentDeclarationRecord] = []
    observations: list[Observation]
    # Human-readable list of what was withheld, printed on the data-protection page so
    # a reader knows an absence is a redaction, not a missing record.
    redactions: list[str]

    def as_json_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    def latest_declared_facts(self) -> dict[str, Any]:
        """The newest declared value of each police/notification fact. Declarations are
        append-only, so a correction arrives as a later row and wins field by field."""
        latest: dict[str, Any] = {}
        for declaration in sorted(self.declarations, key=lambda d: d.declared_at):
            for name, value in declaration.model_dump(exclude={"declaration_id", "declared_at", "tier"}).items():
                if value is not None:
                    latest[name] = value
        return latest


AuditPackPurpose = Literal[
    "insurance_claim", "delivery_dispute", "police_report", "client_audit", "sla_evidence",
]


class PackIssue(_Frozen):
    """Who a pack was issued to and why — printed on every page, so a copy that leaks
    says whose it was."""

    pack_label: str
    recipient_name: str
    recipient_organization: str
    purpose: AuditPackPurpose
    external_reference: str | None
    issued_by_name: str
    issued_at: datetime
    expires_at: datetime
    verify_url: str | None


# ── Issue / read DTOs ─────────────────────────────────────────────────────────

# Link lifetimes on offer. Fixed choices rather than any number: an insurer's claim
# window is weeks, and a link that lives forever is a leak waiting to happen.
AuditPackExpiryDays = Literal[7, 30, 90]
DEFAULT_AUDIT_PACK_EXPIRY_DAYS: AuditPackExpiryDays = 30

AuditPackStatus = Literal["active", "expired", "revoked"]

RECIPIENT_MAX_LENGTH = 200     # audit_packs.recipient_name / recipient_organization
RECIPIENT_EMAIL_MAX_LENGTH = 320  # audit_packs.recipient_email (RFC 5321 ceiling)

_RecipientStr = Annotated[
    str, StringConstraints(min_length=1, max_length=RECIPIENT_MAX_LENGTH), AfterValidator(clean_text)
]
_RecipientEmail = Annotated[
    str, StringConstraints(min_length=3, max_length=RECIPIENT_EMAIL_MAX_LENGTH), AfterValidator(clean_text)
]
_Reference = Annotated[
    str, StringConstraints(min_length=1, max_length=REFERENCE_MAX_LENGTH), AfterValidator(clean_text)
]


class AuditPackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient_name: _RecipientStr
    recipient_organization: _RecipientStr
    recipient_email: _RecipientEmail | None = None
    purpose: AuditPackPurpose
    external_reference: _Reference | None = None
    scope_consignment_id: UUID | None = None
    include_location_trail: bool = True
    include_full_driver_id: bool = False
    expires_in_days: AuditPackExpiryDays = DEFAULT_AUDIT_PACK_EXPIRY_DAYS

    def options(self) -> AuditPackOptions:
        return AuditPackOptions(
            scope_consignment_id=self.scope_consignment_id,
            include_location_trail=self.include_location_trail,
            include_full_driver_id=self.include_full_driver_id,
        )


class AuditPackRead(_Frozen):
    id: UUID
    pack_label: str
    trip_id: UUID
    consignment_id: UUID | None
    purpose: str
    external_reference: str | None
    recipient_name: str
    recipient_organization: str
    recipient_email: str | None
    include_location_trail: bool
    include_full_driver_id: bool
    manifest_sha256: str
    pdf_sha256: str
    pdf_size_bytes: int
    anchor_status: str
    hedera_topic_id: str | None
    hedera_sequence_number: int | None
    hedera_tx_id: str | None
    hedera_consensus_at: datetime | None
    issued_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    status: AuditPackStatus
    view_count: int
    last_viewed_at: datetime | None


class AuditPackIssued(_Frozen):
    """Returned once, at issue: the only time the raw share token exists anywhere."""

    pack: AuditPackRead
    share_token: str
    share_url: str
    verify_url: str


class AuditPackAccessEventRead(_Frozen):
    event_type: str
    client_ip: str | None
    user_agent: str | None
    created_at: datetime


# ── Public (share-link) DTOs ──────────────────────────────────────────────────

# Same vocabulary as VerifyStatus, so the page and the dispatcher's verify panel agree.
LiveCheckStatus = Literal["verified", "db_mismatch", "hedera_mismatch", "no_receipt", "error"]


class SealReceipt(_Frozen):
    canonical_payload: str
    data_hash: str
    hedera_topic_id: str | None
    hedera_sequence_number: int | None
    hedera_tx_id: str | None
    hedera_consensus_at: datetime | None


class PublicPackSeal(_Frozen):
    """Everything needed to check a pack's seal and nothing about the trip itself — safe
    to show to whoever holds a forwarded PDF."""

    pack_id: UUID
    pack_label: str
    issued_at: datetime
    expires_at: datetime
    revoked: bool
    anchor_status: str
    manifest_sha256: str
    pdf_sha256: str
    seal: SealReceipt | None
    hedera_network: str
    mirror_base_url: str


class PublicAuditPackView(_Frozen):
    seal: PublicPackSeal
    recipient_name: str
    recipient_organization: str
    purpose: str
    external_reference: str | None
    manifest: AuditPackManifest


class LiveRecordCheck(_Frozen):
    receipt_id: UUID
    subject_type: str
    subject_id: UUID
    status: LiveCheckStatus


class LiveVerification(_Frozen):
    checked_at: datetime
    seal_status: LiveCheckStatus
    records: list[LiveRecordCheck]
    # A count only — enough to say "ask for an updated pack", without revealing what
    # was added to someone who only holds the old link.
    records_added_since_issue: int



# ── Incident declarations ─────────────────────────────────────────────────────

SAPS_STATION_MAX_LENGTH = 200   # incident_declarations.saps_station
SAPS_CAS_MAX_LENGTH = 50        # incident_declarations.saps_cas_number
SAPS_OFFICER_MAX_LENGTH = 200   # incident_declarations.saps_officer

_Station = Annotated[str, StringConstraints(min_length=1, max_length=SAPS_STATION_MAX_LENGTH), AfterValidator(clean_text)]
_CasNumber = Annotated[str, StringConstraints(min_length=1, max_length=SAPS_CAS_MAX_LENGTH), AfterValidator(clean_text)]
_Officer = Annotated[str, StringConstraints(min_length=1, max_length=SAPS_OFFICER_MAX_LENGTH), AfterValidator(clean_text)]

_DECLARED_FACTS = (
    "saps_station", "saps_cas_number", "saps_officer", "reported_to_saps_at", "tracking_company_notified_at",
    "insurer_notified_at", "client_notified_at", "insurer_claim_reference",
)


class IncidentDeclarationCreate(BaseModel):
    """What a claim form asks for that FreightProof never captured. Append-only: a
    correction is a new declaration, so what was declared when stays on record."""

    model_config = ConfigDict(extra="forbid")

    exception_id: UUID | None = None
    saps_station: _Station | None = None
    saps_cas_number: _CasNumber | None = None
    saps_officer: _Officer | None = None
    reported_to_saps_at: AwareDatetime | None = None
    tracking_company_notified_at: AwareDatetime | None = None
    insurer_notified_at: AwareDatetime | None = None
    client_notified_at: AwareDatetime | None = None
    insurer_claim_reference: _Reference | None = None
    note: FreeText | None = None

    @model_validator(mode="after")
    def _declares_something(self) -> "IncidentDeclarationCreate":
        if all(getattr(self, name) is None for name in _DECLARED_FACTS):
            raise ValueError("Declare at least one police or notification fact.")
        return self
