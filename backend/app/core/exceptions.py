"""Domain exceptions raised by the orchestration layer.

Endpoints catch these and map them to the appropriate HTTP status codes.
Do not import FastAPI here — this module must remain framework-agnostic.
"""


class TripConflictError(Exception):
    """Raised when a trip with the given order_number is already active."""

    def __init__(self, order_number: str) -> None:
        super().__init__(
            f"An active trip already exists for order_number='{order_number}'. "
            "Cancel or close the existing trip before creating a new one."
        )
        self.order_number = order_number


class ResourceNotFoundError(Exception):
    """Raised when a required DB record does not exist or is not accessible."""

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(f"{resource} with id='{resource_id}' not found or inactive.")
        self.resource = resource
        self.resource_id = resource_id


class DuplicateResourceError(Exception):
    """Raised when a unique constraint would be violated (e.g. duplicate id_number)."""

    def __init__(self, resource: str, field: str, value: str) -> None:
        super().__init__(f"{resource} with {field}='{value}' already exists.")
        self.resource = resource
        self.field = field
        self.value = value


class PhaseSequenceError(Exception):
    """Raised when a phase is completed out of order (gated on the phase plan, not trip.status).

    `trip_status` is a reason clause, not necessarily a bare TripStatus value —
    the two call sites in phase_service.py's _gate_and_load have different real
    causes (trip closed/cancelled/held vs. an earlier phase still unresolved)
    and each passes a clause describing its own cause accurately.
    """

    def __init__(self, trip_status: str, attempted_handshake: str) -> None:
        super().__init__(f"Cannot complete {attempted_handshake}: {trip_status}.")
        self.trip_status = trip_status
        self.attempted_handshake = attempted_handshake


class SubjectNotVisibleError(Exception):
    """Raised when a dispatcher queries a blockchain subject outside their organisation."""

    def __init__(self, subject_type: str, subject_id: str) -> None:
        self.subject_type = subject_type
        self.subject_id = subject_id
        super().__init__(f"Subject {subject_type}/{subject_id} not visible to caller's org")


class PPSyncError(Exception):
    """Raised when the Parcel Perfect sync fails during trip creation."""

    def __init__(self, pp_reference: str, reason: str) -> None:
        self.pp_reference = pp_reference
        self.reason = reason
        super().__init__(f"PP sync failed for {pp_reference!r}: {reason}")


class HederaServiceError(Exception):
    """Base exception for Hedera service failures."""


class HederaTimeoutError(HederaServiceError):
    """Raised when the submit_hash() call exceeds HEDERA_SUBMIT_TIMEOUT_SECONDS.

    Distinct from HederaSubmitError so callers/logs can tell "Hedera never
    responded in time" apart from "Hedera responded with a rejection".
    """


class PhaseTypeMismatchError(Exception):
    """Raised when a completion payload's phase_type does not match the addressed row's.

    A client bug, not a sequencing problem: the driver app resolved a phase_event_id
    and then sent the wrong shape for it (or addressed a phase — trip_creation,
    in_transit — that no driver action completes). Distinct from PhaseSequenceError
    so the 409 body says which of the two actually happened.
    """

    def __init__(self, expected: str, received: str) -> None:
        super().__init__(
            f"Payload phase_type='{received}' does not match the addressed phase, "
            f"which is '{expected}'."
        )
        self.expected = expected
        self.received = received
