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


class TripType(str, enum.Enum):
    """Loaded = normal cargo run; empty_leg = repositioning, no consignments."""
    LOADED    = "loaded"
    EMPTY_LEG = "empty_leg"


class PhaseType(str, enum.Enum):
    """One entry in a trip's committed phase plan (parent plan D5); plan LENGTH is
    data generated per trip, so this enum's cardinality is not the phase count of
    any one trip — a type can appear more than once on a multi-stop route."""

    TRIP_CREATION = "trip_creation"
    ACTIVATION    = "activation"
    LOADING       = "loading"
    DEPARTURE     = "departure"
    IN_TRANSIT    = "in_transit"
    UNLOADING     = "unloading"
    CONFIRMATION  = "confirmation"


class PhaseStatus(str, enum.Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"
    EXCEPTION   = "exception"
    OVERRIDDEN  = "overridden"


class AnchorStatus(str, enum.Enum):
    """Hedera anchor state for one phase event (parent plan D4). A phase may be
    `completed` while its anchor is `failed` — that keeps the fail-open policy (D7)
    honest, since the system still knows a receipt is owed. Never render `failed`
    as success."""

    NOT_REQUIRED = "not_required"
    PENDING      = "pending"
    ANCHORED     = "anchored"
    FAILED       = "failed"


class ExceptionType(str, enum.Enum):
    SEAL_MISMATCH          = "seal_mismatch"
    # Distinct from SEAL_MISMATCH: MISMATCH means two recorded seals differ (a
    # theft indicator); UNVERIFIED means no departure seal exists to compare (a
    # gap in the chain, not evidence of tampering).
    SEAL_UNVERIFIED        = "seal_unverified"
    PARCEL_COUNT_MISMATCH  = "parcel_count_mismatch"
    GPS_MISMATCH           = "gps_mismatch"
    # Task 5 (trip-location-timeline-improvements): a DISTINCT finding from
    # GPS_MISMATCH. GPS_MISMATCH is "the vehicle tracker disagrees with the
    # PRECINCT" (FP-145, geofence_service); this is "the driver's OWN PHONE
    # disagrees with the vehicle tracker" (proximity_service.evaluate_proximity) —
    # independent questions that can both fire, or either alone, on the same
    # handshake. See orchestration/action_location_service.record_separation_finding.
    DRIVER_VEHICLE_SEPARATION = "driver_vehicle_separation"
    ROUTE_DEVIATION        = "route_deviation"
    VEHICLE_SUBSTITUTION   = "vehicle_substitution"
    DRIVER_SUBSTITUTION    = "driver_substitution"
    CHECKPOINT_TIMEOUT     = "checkpoint_timeout"
    WAYBILL_COUNT_MISMATCH = "waybill_count_mismatch"
    # Same MISMATCH/UNVERIFIED distinction as SEAL_MISMATCH/SEAL_UNVERIFIED above:
    # MISMATCH means identity was checked and disagreed (fraud signal); UNVERIFIED
    # means no check completed (a gap, often benign).
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


class BlockchainReceiptType(str, enum.Enum):
    JOURNEY_LOCK        = "journey_lock"
    PICKUP              = "pickup"
    DELIVERY            = "delivery"
    CHECKPOINT_BATCH    = "checkpoint_batch"
    EXCEPTION_BATCH     = "exception_batch"
    DRIVER_SUBSTITUTION = "driver_substitution"
    VEHICLE_CREATED     = "vehicle_created"
    VEHICLE_UPDATED     = "vehicle_updated"
    DRIVER_CREATED      = "driver_created"
    DRIVER_UPDATED      = "driver_updated"
    PRECINCT_CREATED    = "precinct_created"
    PRECINCT_UPDATED    = "precinct_updated"


class SubjectType(str, enum.Enum):
    TRIP            = "trip"
    VEHICLE         = "vehicle"
    DRIVER          = "driver"
    VEHICLE_EVENT   = "vehicle_event"
    DRIVER_EVENT    = "driver_event"
    PHASE_EVENT     = "phase_event"
    PRECINCT_EVENT  = "precinct_event"


class VehicleEventType(str, enum.Enum):
    CREATED                = "created"
    LICENSE_PLATE_CHANGED  = "license_plate_changed"
    LICENSE_DISC_RENEWED   = "license_disc_renewed"
    VIN_UPDATED            = "vin_updated"
    VEHICLE_UPDATED        = "vehicle_updated"   # multiple critical fields changed at once
    DEACTIVATED            = "deactivated"
    COSMETIC_UPDATE        = "cosmetic_update"


class DriverEventType(str, enum.Enum):
    CREATED          = "created"
    LICENSE_RENEWED  = "license_renewed"
    DEACTIVATED      = "deactivated"
    COSMETIC_UPDATE  = "cosmetic_update"


class PrecinctEventType(str, enum.Enum):
    CREATED          = "created"
    # Coordinates moved; separate from a resize since one changes WHERE the
    # facility is, the other changes HOW CLOSE a handshake must be to count as inside it.
    RELOCATED        = "relocated"
    GEOFENCE_RESIZED = "geofence_resized"
    SHARING_CHANGED  = "sharing_changed"
    COSMETIC_UPDATE  = "cosmetic_update"


class VerifyStatus(str, enum.Enum):
    VERIFIED          = "verified"
    DB_MISMATCH       = "db_mismatch"
    HEDERA_MISMATCH   = "hedera_mismatch"
    NO_RECEIPT        = "no_receipt"
    # Mirror node unreachable, SDK misconfigured, or bad stored topic_id — not tamper evidence.
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
    to match against proves a human confirmed, never who they were.
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
    """What a dispatcher concluded when reviewing an exception. LEGACY_REVIEW is not
    a real choice (see DispatcherReviewOutcome) — it only back-marks a pre-existing
    `resolved=true` row as reviewed with no recorded finding."""

    NO_ACTION_REQUIRED     = "no_action_required"
    HANDLED_EXTERNALLY     = "handled_externally"
    EVIDENCE_VERIFIED      = "evidence_verified"
    DATA_DISCREPANCY       = "data_discrepancy"
    REFERRED_FOR_FOLLOW_UP = "referred_for_follow_up"
    LEGACY_REVIEW          = "legacy_review"


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
