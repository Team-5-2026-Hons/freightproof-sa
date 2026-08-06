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


class PhaseTooEarlyError(Exception):
    """Raised when a driver tries to activate a trip before its scheduled day.

    Distinct from PhaseSequenceError even though both map to 409: that one means the
    plan is out of order, this one means the plan is fine and the calendar is not.
    Keeping them separate is what lets the driver app show the driver a date instead
    of a generic "trip state changed" message.

    `scheduled_for` is a pre-formatted, human-readable date (or None when the trip
    carries no schedule at all) — the message it builds is surfaced verbatim to the
    driver, so it has to read as something a person wrote.
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

    Distinct from PhaseTooEarlyError (the calendar says no) and PhaseSequenceError (this
    trip's own plan says no): here both the plan and the calendar are fine, and the
    obstacle is a DIFFERENT trip. Keeping it separate is what lets the driver app name
    the trip they have to deal with first instead of showing a generic conflict.

    `blocking_trip_reference` is a driver-facing trip reference, never an id — the message
    is surfaced verbatim in the PWA, so it has to name something the driver can find on
    their own trip list.
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

    A consignment is cargo, and cargo is on exactly one trip. Silently reusing the
    reference does not merely duplicate a row - the second trip's creation restamps
    the existing consignment's pickup/delivery stops onto its own route, rewriting
    the FIRST trip's phase-plan basis after that trip was already anchored. That is
    evidence changing under a closed record, so this fails closed.

    Distinct from PPSyncError: Parcel Perfect answered correctly and the waybill is
    real. The conflict is ours, and the caller maps it to 409, not 422.
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
    """Raised when a dispatcher lifecycle action is attempted against a trip whose
    current status makes the action illegal — e.g. cancelling an already-closed or
    already-cancelled trip.

    Distinct from PhaseSequenceError: that means "out of order in the plan"; this
    means "the trip itself is already in a terminal state", which is a different
    fact and deserves its own message rather than being folded into the phase
    gate's vocabulary.
    """

    def __init__(self, current_status: str, attempted_action: str) -> None:
        super().__init__(
            f"Cannot {attempted_action} trip: current status is '{current_status}'."
        )
        self.current_status = current_status
        self.attempted_action = attempted_action


class PhaseBlockedError(Exception):
    """Raised when a phase is waiting on an external system it cannot proceed without.

    Distinct from PhaseSequenceError and PhaseTooEarlyError even though all three map
    to 409, for the same reason those two are distinct from each other: the plan is in
    order and the calendar is fine, a third party simply has not finished. Keeping it
    separate lets the driver app say "waiting for the warehouse" instead of a generic
    "trip state changed".
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
