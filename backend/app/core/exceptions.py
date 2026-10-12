"""Domain exceptions raised by the orchestration layer.

Endpoints catch these and map them to the appropriate HTTP status codes.
Do not import FastAPI here — this module must remain framework-agnostic.
"""

import uuid
from typing import Any


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


class ExceptionClaimedByColleagueError(Exception):
    """Raised when a request meets a colleague's claim without saying it means to take over.

    Not a lock — anyone may take over, by claiming or reviewing with take_over=True. This
    only refuses the *silent* override: a page loaded before the colleague claimed would
    otherwise replace their claim without the dispatcher ever seeing it existed.
    """

    def __init__(self, exception_id: str) -> None:
        super().__init__(
            f"Exception '{exception_id}' is claimed by another dispatcher. "
            "Take it over before acting on it."
        )


class ExceptionNotOpenError(Exception):
    """Raised when claiming or releasing an exception that is already reviewed — by
    then, who claimed it is part of the record, not a work assignment."""

    def __init__(self, exception_id: str) -> None:
        super().__init__(f"Exception '{exception_id}' is already reviewed; its claim can no longer change.")


class BatchReviewRejectedError(Exception):
    """A batch review that breaks a batch rule (a critical row, rows from another trip).
    422, not 409: nothing changed underneath the caller — the request itself is not a
    reviewable batch."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)


class PhaseSequenceError(Exception):
    """Raised when a phase is completed out of order (gated on the phase plan, not trip.status).

    `trip_status` is a reason clause, not necessarily a bare TripStatus value
    — each call site in phases/gate.py's _gate_and_load describes its own cause.
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

    def __init__(self, pp_reference: str, trip_reference: str | None) -> None:
        self.pp_reference = pp_reference
        self.trip_reference = trip_reference
        # A foreign holder still blocks, but its internal trip identity is private.
        holder = f"trip {trip_reference}" if trip_reference is not None else "another trip"
        super().__init__(
            f"Waybill {pp_reference!r} is already assigned to {holder}. "
            "A consignment belongs to one trip - remove it there first, or use a different waybill."
        )


class ConsignmentScannedOnCancelledTripError(ConsignmentAlreadyAssignedError):
    """A waybill's parcels were scanned on a cancelled trip, so it cannot move to a new
    one (FP-281 §10.5). A subclass, so every existing 409 handler covers it unchanged."""

    def __init__(self, pp_reference: str, trip_reference: str | None) -> None:
        super().__init__(pp_reference, trip_reference)
        # The parent's "already on trip X" is not the reason here; say what is.
        holder = f"cancelled trip {trip_reference}" if trip_reference is not None else "another cancelled trip"
        self.args = (
            f"Waybill {pp_reference!r} was scanned on {holder}, so its "
            "parcels cannot move to a new trip. Handing a loaded manifest to another truck "
            "is not supported yet.",
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


class PPManifestAlreadyOnTripError(Exception):
    """A non-cancelled trip already carries this PP manifest (FP-281 §6). trip_id and
    trip_reference name it; both are None only when a lost race's winner rolled back."""

    def __init__(self, *, trip_id: uuid.UUID | None, trip_reference: str | None) -> None:
        holder = f" {trip_reference}" if trip_reference else ""
        super().__init__(
            f"This manifest is already on trip{holder}. "
            "Cancel that trip before creating a new one."
        )
        self.trip_id = trip_id
        self.trip_reference = trip_reference


class PPUnavailableError(Exception):
    """Parcel Perfect could not be reached or returned an error (502)."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"Parcel Perfect is unavailable: {reason}")
        self.reason = reason


class PPManifestUnusableError(Exception):
    """The PP manifest cannot become a trip as it stands (FP-281 §10.7's 422 cases).
    code is a stable string the screen can switch on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class PPManifestChangedError(Exception):
    """The PP manifest changed between the dispatcher's preview and create (FP-281
    §10.2). Carries the fresh preview, already JSON-shaped, so the 409 shows what changed."""

    def __init__(self, manifest_number: int, preview: dict[str, Any]) -> None:
        super().__init__(
            f"Manifest {manifest_number} changed since it was previewed. Review it again."
        )
        self.manifest_number = manifest_number
        self.preview = preview


class WaybillNotFoundError(Exception):
    """The parcel system has no waybill under this reference (404).

    Domain-side twin of the integration's lookup error, so the API layer can map it
    without importing the integration. The message is client-facing: keep it stable.
    """

    def __init__(self, waybill_number: str) -> None:
        super().__init__(f"Waybill {waybill_number!r} not found in Parcel Perfect")
        self.waybill_number = waybill_number


class ManifestNotFoundError(Exception):
    """The parcel system has no manifest under this number (404). Client-facing message."""

    def __init__(self, manifest_number: int) -> None:
        super().__init__(f"Manifest {manifest_number} not found")
        self.manifest_number = manifest_number


class ManifestLookupUnsupportedError(Exception):
    """The connected parcel system cannot look manifests up (501). Carries no detail on
    purpose: the integration's own message is an internal engineering note."""


class StoredFileMismatchError(Exception):
    """A stored file is missing or no longer hashes to the value recorded when it was
    stored (409 for an issued audit pack). Domain-side twin of the storage layer's
    integrity error, so the API layer can map it without importing app.storage."""


class FileStorageUnavailableError(Exception):
    """Object storage could not be reached, so nothing was read or written (503).
    Domain-side twin of the storage layer's availability error."""
