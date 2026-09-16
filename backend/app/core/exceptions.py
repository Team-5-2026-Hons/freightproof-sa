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


class ExceptionAlreadyReviewedError(Exception):
    """Raised when a DIFFERENT dispatcher already reviewed this exception.

    Not raised on a replay by the same dispatcher (double-tap/retry, same
    account, nothing lost). The first review stays the record; a 200 that
    silently discarded a second dispatcher's note would misreport success.
    """

    def __init__(self, exception_id: str) -> None:
        super().__init__(
            f"Exception '{exception_id}' was already reviewed by another dispatcher. "
            "Their review is the record; re-read it before reviewing again."
        )
        self.exception_id = exception_id


class PhaseSequenceError(Exception):
    """Raised when a phase is completed out of order (gated on the phase plan, not trip.status).

    `trip_status` is a reason clause, not necessarily a bare TripStatus value
    — each call site in phase_service.py's _gate_and_load describes its own cause.
    """

    def __init__(self, trip_status: str, attempted_handshake: str) -> None:
        super().__init__(f"Cannot complete {attempted_handshake}: {trip_status}.")
        self.trip_status = trip_status
        self.attempted_handshake = attempted_handshake


class PhaseTooEarlyError(Exception):
    """Raised when a driver tries to activate a trip before its scheduled day.

    Distinct from PhaseSequenceError (plan out of order) — here the plan is
    fine, the calendar isn't, so the driver app can show a date.

    `scheduled_for` is a pre-formatted, human-readable date (or None), since
    the message is surfaced verbatim to the driver.
    """

    def __init__(self, scheduled_for: str | None, attempted_phase: str) -> None:
        if scheduled_for is None:
            reason = (
                "this trip has no scheduled departure date, so there is nothing to "
                "confirm it is due. Ask your dispatcher to set one"
            )
        else:
            reason = f"this trip is scheduled for {scheduled_for} and cannot be started before then"
        super().__init__(f"Cannot complete {attempted_phase}: {reason}.")
        self.scheduled_for = scheduled_for
        self.attempted_phase = attempted_phase


class TripActivationBlockedError(Exception):
    """Raised when another of the driver's trips stands in the way of activating this one.

    Distinct from PhaseTooEarlyError/PhaseSequenceError: plan and calendar
    are both fine here, the obstacle is a different trip, so the driver app
    can name it.

    `blocking_trip_reference` is a driver-facing reference, never an id —
    surfaced verbatim in the PWA.
    """

    def __init__(self, blocking_trip_reference: str, reason: str) -> None:
        super().__init__(
            f"Cannot start this trip: {reason} ({blocking_trip_reference})."
        )
        self.blocking_trip_reference = blocking_trip_reference
        self.reason = reason


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


class ConsignmentAlreadyAssignedError(Exception):
    """Raised when a PP waybill is put on a second trip while still on its first.

    A consignment belongs to exactly one trip; reassigning it would rewrite
    the first trip's already-anchored phase-plan basis — evidence changing
    under a closed record, so this fails closed. Distinct from PPSyncError
    (PP answered correctly here); maps to 409, not 422.
    """

    def __init__(self, pp_reference: str, trip_reference: str) -> None:
        self.pp_reference = pp_reference
        self.trip_reference = trip_reference
        super().__init__(
            f"Waybill {pp_reference!r} is already assigned to trip {trip_reference}. "
            "A consignment belongs to one trip - remove it there first, or use a different waybill."
        )


class HederaServiceError(Exception):
    """Base exception for Hedera service failures."""


class HederaTimeoutError(HederaServiceError):
    """Raised when the submit_hash() call exceeds HEDERA_SUBMIT_TIMEOUT_SECONDS.

    Distinct from HederaSubmitError so callers/logs can tell "Hedera never
    responded in time" apart from "Hedera responded with a rejection".
    """


class TripStateError(Exception):
    """Raised when a dispatcher lifecycle action is attempted against a trip
    whose current status makes it illegal (e.g. cancelling an already-closed
    trip). Distinct from PhaseSequenceError: this is a terminal trip state,
    not an out-of-order plan.
    """

    def __init__(self, current_status: str, attempted_action: str) -> None:
        super().__init__(
            f"Cannot {attempted_action} trip: current status is '{current_status}'."
        )
        self.current_status = current_status
        self.attempted_action = attempted_action


class PhaseBlockedError(Exception):
    """Raised when a phase is waiting on an external system it cannot proceed
    without. Distinct from PhaseSequenceError/PhaseTooEarlyError: plan and
    calendar are fine, a third party just hasn't finished — so the driver
    app can say "waiting for the warehouse" instead of a generic message.
    """

    def __init__(self, attempted_phase: str) -> None:
        super().__init__(
            f"Cannot complete {attempted_phase}: the warehouse has not finished "
            f"scanning at this stop. This will clear on its own once they do — "
            f"contact your dispatcher if it does not."
        )
        self.attempted_phase = attempted_phase


class PhaseTypeMismatchError(Exception):
    """Raised when a completion payload's phase_type does not match the addressed row's.

    A client bug, not a sequencing problem: the driver app resolved a
    phase_event_id and sent the wrong shape for it (or addressed
    trip_creation, the one phase no driver action completes). Distinct from
    PhaseSequenceError so the 409 body says which of the two happened.
    """

    def __init__(self, expected: str, received: str) -> None:
        super().__init__(
            f"Payload phase_type='{received}' does not match the addressed phase, "
            f"which is '{expected}'."
        )
        self.expected = expected
        self.received = received
