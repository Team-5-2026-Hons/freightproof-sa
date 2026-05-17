import enum


class OrganizationType(str, enum.Enum):
    OPERATOR  = "operator"
    PRINCIPAL = "principal"
    BOTH      = "both"


class VehicleType(str, enum.Enum):
    HORSE   = "horse"
    TRAILER = "trailer"


class TripStatus(str, enum.Enum):
    CREATED          = "created"
    ORIGIN_GATE_IN   = "origin_gate_in"
    LOADING          = "loading"
    ORIGIN_GATE_OUT  = "origin_gate_out"
    IN_TRANSIT       = "in_transit"
    DEST_GATE_IN     = "dest_gate_in"
    UNLOADING        = "unloading"
    CLOSED           = "closed"
    CANCELLED        = "cancelled"
    EXCEPTION_HOLD   = "exception_hold"


class HandshakeType(str, enum.Enum):
    TRIP_CREATION   = "trip_creation"
    ORIGIN_GATE_IN  = "origin_gate_in"
    LOADING         = "loading"
    ORIGIN_GATE_OUT = "origin_gate_out"
    DEST_GATE_IN    = "dest_gate_in"
    UNLOADING       = "unloading"


class HandshakeStatus(str, enum.Enum):
    PENDING     = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED   = "completed"
    EXCEPTION   = "exception"
    OVERRIDDEN  = "overridden"


class ExceptionType(str, enum.Enum):
    SEAL_MISMATCH          = "seal_mismatch"
    PARCEL_COUNT_MISMATCH  = "parcel_count_mismatch"
    GPS_MISMATCH           = "gps_mismatch"
    ROUTE_DEVIATION        = "route_deviation"
    VEHICLE_SUBSTITUTION   = "vehicle_substitution"
    DRIVER_SUBSTITUTION    = "driver_substitution"
    CHECKPOINT_TIMEOUT     = "checkpoint_timeout"
    WAYBILL_COUNT_MISMATCH = "waybill_count_mismatch"
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


class SubjectType(str, enum.Enum):
    TRIP            = "trip"
    VEHICLE         = "vehicle"
    DRIVER          = "driver"
    VEHICLE_EVENT   = "vehicle_event"
    DRIVER_EVENT    = "driver_event"


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


class ParcelStatus(str, enum.Enum):
    PENDING     = "pending"
    SCANNED_OUT = "scanned_out"
    SCANNED_IN  = "scanned_in"
    EXCEPTION   = "exception"
