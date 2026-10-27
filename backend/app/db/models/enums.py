import enum


class DispatcherRole(str, enum.Enum):
    DISPATCHER       = "dispatcher"
    ADMIN_DISPATCHER = "admin_dispatcher"


class OrganizationType(str, enum.Enum):
    OPERATOR  = "operator"
    PRINCIPAL = "principal"
    BOTH      = "both"


class VehicleType(str, enum.Enum):
    HORSE   = "horse"
    TRAILER = "trailer"


class TripStatus(str, enum.Enum):
    """Coarse trip lifecycle; the phase ledger (PhaseEvent), not this field, sequences
    a trip. Nothing may branch on trip.status for sequencing — only for the coarse
    created/active/closed/cancelled/held description."""

    CREATED          = "created"
    ACTIVE           = "active"
    CLOSED           = "closed"
    CANCELLED        = "cancelled"
    EXCEPTION_HOLD   = "exception_hold"


class PushPlatform(str, enum.Enum):
    """The native shell a push token came from; the sender picks the FCM/APNs path by it."""
    ANDROID = "android"
    IOS     = "ios"


class TripType(str, enum.Enum):
    """Loaded = normal cargo run; empty_leg = repositioning, no consignments."""
    LOADED    = "loaded"
    EMPTY_LEG = "empty_leg"


class PhaseType(str, enum.Enum):
    """One entry in a trip's committed phase plan; plan LENGTH is
    data generated per trip, so this enum's cardinality is not the phase count of
    any one trip — a type can appear more than once on a multi-stop route."""

    TRIP_CREATION = "trip_creation"
    ACTIVATION    = "activation"
    LOADING       = "loading"
    DEPARTURE     = "departure"
    IN_TRANSIT    = "in_transit"
    ARRIVAL       = "arrival"
    UNLOADING     = "unloading"
    CONFIRMATION  = "confirmation"


class SealCondition(str, enum.Enum):
    """The seal's physical condition as the driver finds it at arrival. Stored as a
    plain String, like every enum here, so adding a value needs no migration."""

    INTACT  = "intact"
    DAMAGED = "damaged"
    MISSING = "missing"


class SealNumberSource(str, enum.Enum):
    """How the seal number on a departure or arrival row was entered on the phone.

    Recorded, never anchored: it describes the capture, not the seal, and keeping it out
    of the payload leaves the departure and arrival anchor contracts unchanged."""

    OCR_CONFIRMED = "ocr_confirmed"
    OCR_CORRECTED = "ocr_corrected"
    TYPED         = "typed"


class PhaseStatus(str, enum.Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"
    EXCEPTION   = "exception"
    OVERRIDDEN  = "overridden"


class AnchorStatus(str, enum.Enum):
    """Hedera anchor state for one phase event. A phase may be
    `completed` while its anchor is `failed` — that keeps the fail-open policy
    honest, since the system still knows a receipt is owed. Never render `failed`
    as success."""

    NOT_REQUIRED = "not_required"
    PENDING      = "pending"
    ANCHORED     = "anchored"
    FAILED       = "failed"


class DriverPositionSource(str, enum.Enum):
    """Where a phase event's `driver_phone_lat/lng` pair actually came from.

    Exists so a demo-staged position can never be mistaken for a reading the handset
    took. The dev trigger panel can place a trip's phone at a precinct (see
    app/dev/services/demo_phone.py) so a walkthrough recorded far from any depot does
    not raise a location warning on every phase; a row staged that way is stamped
    `SIMULATED` and stays distinguishable forever.

    `DEVICE` on every real capture, and NULL on rows written before this column
    existed — absence means "not recorded", never "verified real".
    """

    DEVICE    = "device"
    SIMULATED = "simulated"


class ExceptionType(str, enum.Enum):
    SEAL_MISMATCH          = "seal_mismatch"
    SEAL_UNVERIFIED        = "seal_unverified"
    SEAL_COMPROMISED       = "seal_compromised"
    PARCEL_COUNT_MISMATCH  = "parcel_count_mismatch"
    GPS_MISMATCH           = "gps_mismatch"
    DRIVER_VEHICLE_SEPARATION = "driver_vehicle_separation"
    DRIVER_LOCATION_MISMATCH = "driver_location_mismatch"
    TRAILER_LOCATION_MISMATCH = "trailer_location_mismatch"
    TRAILER_SEPARATED_IN_TRANSIT = "trailer_separated_in_transit"
    MOVED_BEFORE_DEPARTURE = "moved_before_departure"
    TRACKER_SILENT = "tracker_silent"
    ROUTE_DEVIATION       = "route_deviation"
    VEHICLE_SUBSTITUTION   = "vehicle_substitution"
    DRIVER_SUBSTITUTION    = "driver_substitution"
    CHECKPOINT_TIMEOUT     = "checkpoint_timeout"
    WAYBILL_COUNT_MISMATCH = "waybill_count_mismatch"
    RECEIVER_ID_MISMATCH   = "receiver_id_mismatch"
    RECEIVER_ID_UNVERIFIED = "receiver_id_unverified"
    SEQUENCE_VIOLATION     = "sequence_violation"
    PANIC_BUTTON           = "panic_button"
    DELIVERY_REFUSED       = "delivery_refused"
    CARGO_DAMAGE           = "cargo_damage"
    SEAL_BROKEN_IN_TRANSIT = "seal_broken_in_transit"
    MECHANICAL             = "mechanical"
    DOCUMENT_REVIEW        = "document_review"
    DISPATCHER_NOTE        = "dispatcher_note"
    ESCALATION             = "escalation"
    TRIP_HOLD              = "trip_hold"


class ExceptionSource(str, enum.Enum):
    SYSTEM     = "system"
    DRIVER     = "driver"
    DISPATCHER = "dispatcher"


class ExceptionSeverity(str, enum.Enum):
    INFO     = "info"
    WARNING  = "warning"
    CRITICAL = "critical"


class ArtifactType(str, enum.Enum):
    PHOTO    = "photo"
    DOCUMENT = "document"


class EvidenceRole(str, enum.Enum):
    """What a capture was taken for. Each value is the stem of the phase column that
    records the submitted copy (<value>_artifact_id) and of its anchored hash key
    (<value>_sha256), so it is frozen like those names."""
    LINEHAUL_PHOTO = "linehaul_photo"
    LINEHAUL_PDF   = "linehaul_pdf"
    SEAL_PHOTO     = "seal_photo"
    WAYBILL_PHOTO  = "waybill_photo"
    POD_PHOTO      = "pod_photo"
    POD_SIGNATURE  = "pod_signature"


class BlockchainReceiptType(str, enum.Enum):
    JOURNEY_LOCK        = "journey_lock"
    PICKUP              = "pickup"
    DELIVERY            = "delivery"
    ACTIVATION          = "activation"
    LOADING             = "loading"
    TRANSIT_ARRIVAL     = "transit_arrival"
    ARRIVAL_INSPECTION  = "arrival_inspection"
    UNLOADING           = "unloading"
    PHASE_OVERRIDE      = "phase_override"
    CHECKPOINT_BATCH    = "checkpoint_batch"
    EXCEPTION_BATCH     = "exception_batch"
    DRIVER_SUBSTITUTION = "driver_substitution"
    VEHICLE_CREATED     = "vehicle_created"
    VEHICLE_UPDATED     = "vehicle_updated"
    DRIVER_CREATED      = "driver_created"
    DRIVER_UPDATED      = "driver_updated"
    PRECINCT_CREATED    = "precinct_created"
    PRECINCT_UPDATED    = "precinct_updated"
    AUDIT_PACK_ISSUED   = "audit_pack_issued"
    EXCEPTION_RAISED    = "exception_raised"
    EXCEPTION_REVIEWED  = "exception_reviewed"
    TRIP_CANCELLED      = "trip_cancelled"
    DRIVER_SUBSTITUTION_CORRECTED = "driver_substitution_corrected"


class SubjectType(str, enum.Enum):
    TRIP            = "trip"
    VEHICLE         = "vehicle"
    DRIVER          = "driver"
    VEHICLE_EVENT   = "vehicle_event"
    DRIVER_EVENT    = "driver_event"
    PHASE_EVENT     = "phase_event"
    PRECINCT_EVENT  = "precinct_event"
    AUDIT_PACK      = "audit_pack"
    EVIDENCE_EVENT  = "evidence_event"
    DRIVER_SUBSTITUTION = "driver_substitution"
    DRIVER_SUBSTITUTION_CORRECTION = "driver_substitution_correction"


class VehicleEventType(str, enum.Enum):
    CREATED                = "created"
    LICENSE_PLATE_CHANGED  = "license_plate_changed"
    LICENSE_DISC_RENEWED   = "license_disc_renewed"
    VIN_UPDATED            = "vin_updated"
    VEHICLE_UPDATED        = "vehicle_updated"
    DEACTIVATED            = "deactivated"
    COSMETIC_UPDATE        = "cosmetic_update"


class DriverEventType(str, enum.Enum):
    CREATED          = "created"
    LICENSE_RENEWED  = "license_renewed"
    DEACTIVATED      = "deactivated"
    COSMETIC_UPDATE  = "cosmetic_update"


class PrecinctEventType(str, enum.Enum):
    CREATED          = "created"
    RELOCATED        = "relocated"
    GEOFENCE_RESIZED = "geofence_resized"
    GEOFENCE_RESHAPED = "geofence_reshaped"
    SHARING_CHANGED  = "sharing_changed"
    COSMETIC_UPDATE  = "cosmetic_update"


class VerifyStatus(str, enum.Enum):
    VERIFIED          = "verified"
    DB_MISMATCH       = "db_mismatch"
    HEDERA_MISMATCH   = "hedera_mismatch"
    NO_RECEIPT        = "no_receipt"
    ERROR             = "error"


class MerkleBatchType(str, enum.Enum):
    CHECKPOINT = "checkpoint"
    EXCEPTION  = "exception"
    DOCUMENT   = "document"


class IdvsStatus(str, enum.Enum):
    PENDING  = "pending"
    VERIFIED = "verified"
    FAILED   = "failed"


class ReceiverVerificationStatus(str, enum.Enum):
    """Where one receiver's identity check ended up. PENDING exists only while a
    Didit session is in flight — no trip may reach a terminal state with one still
    open."""

    PENDING    = "pending"
    VERIFIED   = "verified"
    FAILED     = "failed"
    UNVERIFIED = "unverified"


class ReceiverVerificationTier(str, enum.Enum):
    """How much evidence the check actually produced.

    SELFIE_ONLY is presence evidence, not identity evidence: a live face with no document
    to match against proves a human confirmed, never who they were. No longer assigned:
    the receiver selfie was removed (FP-316). Kept so existing rows still load.
    """

    DOCUMENT_AND_FACE = "document_and_face"
    SELFIE_ONLY       = "selfie_only"
    TYPED_ONLY        = "typed_only"


class ReceiverVerificationUnverifiedReason(str, enum.Enum):
    """Why a check did not reach a verdict. Never free text, so a dispatcher can
    separate "no ID on them" from "vendor was down"."""

    NO_DOCUMENT        = "no_document"
    DECLINED_CONSENT   = "declined_consent"
    NO_CONNECTION      = "no_connection"
    QUOTA_EXHAUSTED    = "quota_exhausted"
    VENDOR_UNAVAILABLE = "vendor_unavailable"
    ABANDONED          = "abandoned"


class ParcelStatus(str, enum.Enum):
    PENDING     = "pending"
    SCANNED_OUT = "scanned_out"
    SCANNED_IN  = "scanned_in"
    EXCEPTION   = "exception"


class ExceptionReviewStatus(str, enum.Enum):
    """Where an exception sits in the dispatcher's review workflow. Replaces the old
    `resolved: bool`, which couldn't distinguish "not looked at" from "looked at,
    still needs a decision"."""

    RECORDED     = "recorded"
    NEEDS_REVIEW = "needs_review"
    REVIEWED     = "reviewed"


class ExceptionReviewOutcome(str, enum.Enum):
    """What a dispatcher concluded when reviewing an exception. LEGACY_REVIEW and
    DISPATCHER_AUTHORED are not real choices (see DispatcherReviewOutcome): the first
    only back-marks a pre-existing `resolved=true` row as reviewed with no recorded
    finding, the second marks a dispatcher's own note as reviewed by its author."""

    NO_ACTION_REQUIRED     = "no_action_required"
    HANDLED_EXTERNALLY     = "handled_externally"
    EVIDENCE_VERIFIED      = "evidence_verified"
    DATA_DISCREPANCY       = "data_discrepancy"
    REFERRED_FOR_FOLLOW_UP = "referred_for_follow_up"
    LEGACY_REVIEW          = "legacy_review"
    DISPATCHER_AUTHORED    = "dispatcher_authored"


class DispatcherReviewOutcome(str, enum.Enum):
    """The choices a dispatcher may actually submit — ExceptionReviewOutcome without
    LEGACY_REVIEW, which is a migration-only marker no dispatcher should be able to pick
    for a review happening today."""

    NO_ACTION_REQUIRED     = "no_action_required"
    HANDLED_EXTERNALLY     = "handled_externally"
    EVIDENCE_VERIFIED      = "evidence_verified"
    DATA_DISCREPANCY       = "data_discrepancy"
    REFERRED_FOR_FOLLOW_UP = "referred_for_follow_up"


class ExceptionContactMethod(str, enum.Enum):
    """How a dispatcher reached someone while reviewing an exception. NO_CONTACT_YET
    has no equivalent here — it recorded the absence of contact, which belongs on
    ExceptionReviewOutcome, not a field named for the method of contact."""

    PHONE     = "phone"
    WHATSAPP  = "whatsapp"
    IN_PERSON = "in_person"


class HandoverTokenRejectionReason(str, enum.Enum):
    """Why a receiver capability-token redemption was refused; every value is written
    to HandoverTokenAttempt, since a rejected attempt is itself evidence. UNKNOWN (a
    hash matching no row) is deliberately indistinguishable from
    EXPIRED/ALREADY_REDEEMED to the caller, though the true reason is recorded
    server-side."""

    EXPIRED          = "expired"
    ALREADY_REDEEMED = "already_redeemed"
    WRONG_TRIP       = "wrong_trip"
    WRONG_STOP       = "wrong_stop"
    UNKNOWN          = "unknown"


class AuditPackAccessEventType(str, enum.Enum):
    """What someone holding an audit-pack link did — the issuing dispatcher sees these,
    so a leaked link shows up as views nobody expected. DENIED_* rows record attempts on
    a link that no longer works, which is exactly when a leak would show itself."""

    VIEWED          = "viewed"
    PDF_DOWNLOADED  = "pdf_downloaded"
    PHOTO_VIEWED    = "photo_viewed"
    VERIFY_RUN      = "verify_run"
    DENIED_EXPIRED  = "denied_expired"
    DENIED_REVOKED  = "denied_revoked"
    PASSWORD_EMAILED     = "password_emailed"
    PASSWORD_VERIFIED    = "password_verified"
    DENIED_BAD_PASSWORD  = "denied_bad_password"
    DENIED_UNVERIFIED    = "denied_unverified"


class IncidentType(str, enum.Enum):
    """What an incident investigates. An exception is one observation; an incident is the
    investigation several observations can belong to. Breakdowns are deliberately absent:
    out of MVP scope (Tim, 20 Oct 2026) — MECHANICAL stays an exception."""

    HIJACKING       = "hijacking"
    PARCEL_SHORTAGE = "parcel_shortage"
    PARCEL_DAMAGE   = "parcel_damage"


class IncidentStatus(str, enum.Enum):
    """Where the investigation is. Independent of Trip.status (a trip can close while a
    shortage investigation stays open) and of each exception's review_status."""

    OPEN          = "open"
    INVESTIGATING = "investigating"
    CLOSED        = "closed"


class IncidentConfidence(str, enum.Enum):
    """How well-founded the incident is. A client's phone call stays REPORTED until
    something independent agrees — it never becomes a system-confirmed theft by itself."""

    SUSPECTED    = "suspected"
    REPORTED     = "reported"
    CORROBORATED = "corroborated"


class IncidentReporterRole(str, enum.Enum):
    DRIVER           = "driver"
    CLIENT           = "client"
    RECEIVER         = "receiver"
    TRACKING_COMPANY = "tracking_company"
    POLICE           = "police"
    OPERATOR_STAFF   = "operator_staff"
    FREIGHTPROOF     = "freightproof"
    OTHER            = "other"


class IncidentReportChannel(str, enum.Enum):
    PHONE     = "phone"
    WHATSAPP  = "whatsapp"
    EMAIL     = "email"
    IN_PERSON = "in_person"
    IN_APP    = "in_app"


class IncidentOutcome(str, enum.Enum):
    """What the investigation established. Kept apart from IncidentStatus so closing never
    has to pretend cargo was recovered — INCONCLUSIVE is a legitimate way to close."""

    RECORDING_ERROR    = "recording_error"
    CARGO_RECOVERED    = "cargo_recovered"
    PARTIAL_RECOVERY   = "partial_recovery"
    SHORTAGE_CONFIRMED = "shortage_confirmed"
    DAMAGE_CONFIRMED   = "damage_confirmed"
    THEFT_REPORTED     = "theft_reported"
    INCONCLUSIVE       = "inconclusive"


class IncidentUpdateKind(str, enum.Enum):
    """One entry on an incident's append-only ledger. The status, confidence, owner and
    outcome columns on Incident are caches rebuilt from these, never edited directly."""

    OPENED             = "opened"
    NOTE               = "note"
    STATUS_CHANGED     = "status_changed"
    ASSIGNED           = "assigned"
    CONFIDENCE_CHANGED = "confidence_changed"
    EXCEPTION_LINKED   = "exception_linked"
    PARCEL_ADDED       = "parcel_added"
    PARCEL_FINDING     = "parcel_finding"
    EXTERNAL_ACTION    = "external_action"
    DOCUMENT_ATTACHED  = "document_attached"
    TRIP_STOPPED       = "trip_stopped"
    CLOSED             = "closed"
    REOPENED           = "reopened"


class ParcelFinding(str, enum.Enum):
    """What a dispatcher established about one affected parcel. There is no "stolen" and no
    "no scan recorded" here: a missing scan-in is a scan fact read from Parcel, shown beside
    the finding, and a parcel with no finding yet is simply not established."""

    LOCATED           = "located"
    CONFIRMED_MISSING = "confirmed_missing"
    DAMAGE_CONFIRMED  = "damage_confirmed"
    RECORDING_ERROR   = "recording_error"


class IncidentExternalAction(str, enum.Enum):
    """Something done outside FreightProof that the dispatcher records. FreightProof records
    these responses; it never performs them (docs/scope-boundaries.md §0)."""

    TRACKING_COMPANY_ALERTED = "tracking_company_alerted"
    SAPS_REPORTED            = "saps_reported"
    INSURER_NOTIFIED         = "insurer_notified"
    CLIENT_NOTIFIED          = "client_notified"
    DRIVER_WELFARE_CHECK     = "driver_welfare_check"
    RECOVERY_REPORTED        = "recovery_reported"
    OTHER                    = "other"


def enum_text(value: enum.Enum | str) -> str:
    """The text an enum column stores. str() on a (str, Enum) member gives
    'PhaseType.DEPARTURE', not 'departure' — and a row still in the session holds the
    member while a freshly loaded one holds the plain string, so both must map the same."""
    return str(value.value) if isinstance(value, enum.Enum) else value
