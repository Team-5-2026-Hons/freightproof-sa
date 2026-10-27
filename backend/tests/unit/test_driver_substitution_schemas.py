"""FP-83 C0 — the driver-substitution wire contract (docs/contracts/driver-substitution-v1.md).

The contract document is the single source of truth. These tests pin the validation it
states (coordinates, seal rules, duplicate vehicles, reasons, enum membership, text bounds),
the error code -> HTTP status mapping as data, and — by parsing the shared TypeScript file —
that the Python and TypeScript sides name the same fields and values.

Cross-trip vehicle membership is deliberately absent: it needs the DB and is tested in C4.
"""

import enum
import math
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.db.models.enums import SealCondition
from app.schemas import driver_substitutions as ds
from app.schemas.driver_substitutions import (
    AcknowledgeLateEvidenceRequest,
    ArrangeSubstitutionRequest,
    CancelSubstitutionRequest,
    CompleteSubstitutionRequest,
    ConfirmSubstitutionRequest,
    CorrectSubstitutionRequest,
    ExchangePoint,
    LateEvidenceRequest,
    ReplaceSubstitutionRequest,
    SealCheck,
    SubstitutionCompletionRead,
    SubstitutionErrorCode,
    SubstitutionRequestRead,
    SubstitutionSealCondition,
)

_NOW = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


def _id() -> uuid.UUID:
    return uuid.uuid4()


def _exchange(**over: Any) -> dict[str, Any]:
    return {"label": "Engen Harrismith", "latitude": -28.27, "longitude": 29.13, "instructions": "Fuel island 2", **over}


def _arrange(**over: Any) -> dict[str, Any]:
    return {
        "client_request_id": _id(),
        "incoming_driver_id": _id(),
        "exchange": _exchange(),
        "expected_at": _NOW + timedelta(hours=2),
        "is_planned": True,
        "reason": "Driver hours limit reached",
        **over,
    }


def _seal(condition: str = "intact", **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "vehicle_id": _id(),
        "condition": condition,
        "seal_number": "AB-1234",
        "photo_artifact_ids": [_id()],
        "not_applicable_reason": None,
    }
    return {**base, **over}


def _confirm(**over: Any) -> dict[str, Any]:
    vehicle = _id()
    return {
        "client_request_id": _id(),
        "expected_version": 1,
        "captured_at": _NOW,
        "latitude": -28.27,
        "longitude": 29.13,
        "accuracy_metres": 8.5,
        "confirmed_vehicle_ids": [vehicle],
        "seal_checks": [_seal(vehicle_id=vehicle)],
        "discrepancy_note": None,
        **over,
    }



@pytest.mark.parametrize(
    "present",
    [("latitude",), ("longitude",), ("accuracy_metres",), ("latitude", "longitude"), ("latitude", "accuracy_metres")],
)
def test_partial_capture_coordinates_are_rejected(present: tuple[str, ...]) -> None:
    body = _confirm(latitude=None, longitude=None, accuracy_metres=None)
    for field in present:
        body[field] = {"latitude": -28.27, "longitude": 29.13, "accuracy_metres": 8.5}[field]

    with pytest.raises(ValidationError, match="together"):
        ConfirmSubstitutionRequest(**body)


def test_capture_with_no_coordinates_is_accepted_and_stays_absent() -> None:
    request = ConfirmSubstitutionRequest(**_confirm(latitude=None, longitude=None, accuracy_metres=None))

    assert (request.latitude, request.longitude, request.accuracy_metres) == (None, None, None)


def test_capture_with_all_coordinates_is_accepted() -> None:
    request = ConfirmSubstitutionRequest(**_confirm())

    assert (request.latitude, request.longitude, request.accuracy_metres) == (-28.27, 29.13, 8.5)


@pytest.mark.parametrize(
    "override",
    [
        {"latitude": 90.5},
        {"latitude": -91},
        {"longitude": 180.1},
        {"longitude": -181},
        {"accuracy_metres": -1},
        {"accuracy_metres": math.inf},
        {"accuracy_metres": math.nan},
    ],
)
def test_out_of_range_capture_coordinates_are_rejected(override: dict[str, float]) -> None:
    with pytest.raises(ValidationError):
        ConfirmSubstitutionRequest(**_confirm(**override))



def test_intact_seal_number_is_normalised_by_the_phase_rule() -> None:
    check = SealCheck(**_seal(seal_number="  ab-1234 "))

    assert check.seal_number == "AB-1234"


@pytest.mark.parametrize("condition", ["intact", "damaged"])
@pytest.mark.parametrize("bad_number", [None, "", "1234", "AB1234", "ABC-1234", "AB-12345"])
def test_intact_or_damaged_seal_needs_a_well_formed_number(condition: str, bad_number: str | None) -> None:
    with pytest.raises(ValidationError):
        SealCheck(**_seal(condition, seal_number=bad_number))


@pytest.mark.parametrize("condition", ["intact", "damaged", "missing"])
def test_intact_damaged_or_missing_seal_needs_a_photo(condition: str) -> None:
    number = None if condition == "missing" else "AB-1234"

    with pytest.raises(ValidationError, match="photo"):
        SealCheck(**_seal(condition, seal_number=number, photo_artifact_ids=[]))


def test_missing_seal_with_photo_and_no_number_is_accepted() -> None:
    check = SealCheck(**_seal("missing", seal_number=None))

    assert check.condition is SubstitutionSealCondition.MISSING
    assert check.seal_number is None


def test_missing_seal_must_not_carry_a_number() -> None:
    with pytest.raises(ValidationError, match="seal_number"):
        SealCheck(**_seal("missing", seal_number="AB-1234"))


def test_not_applicable_with_reason_and_no_photos_is_accepted() -> None:
    check = SealCheck(
        **_seal("not_applicable", seal_number=None, photo_artifact_ids=[], not_applicable_reason="  Empty leg  ")
    )

    assert check.not_applicable_reason == "Empty leg"
    assert check.photo_artifact_ids == []


def test_not_applicable_may_carry_optional_photos() -> None:
    check = SealCheck(**_seal("not_applicable", seal_number=None, not_applicable_reason="Empty trailer"))

    assert len(check.photo_artifact_ids) == 1


@pytest.mark.parametrize("reason", [None, "", "   ", "\n\t"])
def test_not_applicable_needs_a_non_whitespace_reason(reason: str | None) -> None:
    with pytest.raises(ValidationError):
        SealCheck(**_seal("not_applicable", seal_number=None, photo_artifact_ids=[], not_applicable_reason=reason))


def test_not_applicable_reason_is_bounded_to_1000_characters() -> None:
    accepted = SealCheck(
        **_seal("not_applicable", seal_number=None, photo_artifact_ids=[], not_applicable_reason="x" * 1000)
    )

    with pytest.raises(ValidationError):
        SealCheck(**_seal("not_applicable", seal_number=None, photo_artifact_ids=[], not_applicable_reason="x" * 1001))
    assert len(accepted.not_applicable_reason or "") == 1000


def test_not_applicable_must_not_carry_a_seal_number() -> None:
    with pytest.raises(ValidationError, match="seal_number"):
        SealCheck(**_seal("not_applicable", seal_number="AB-1234", not_applicable_reason="Empty trailer"))


@pytest.mark.parametrize("condition", ["intact", "damaged", "missing"])
def test_reason_is_null_unless_the_condition_is_not_applicable(condition: str) -> None:
    number = None if condition == "missing" else "AB-1234"

    with pytest.raises(ValidationError, match="not_applicable_reason"):
        SealCheck(**_seal(condition, seal_number=number, not_applicable_reason="because"))


def test_one_seal_check_per_vehicle_and_duplicates_are_rejected() -> None:
    vehicle = _id()
    body = _confirm(
        confirmed_vehicle_ids=[vehicle],
        seal_checks=[_seal(vehicle_id=vehicle), _seal("missing", vehicle_id=vehicle, seal_number=None)],
    )

    with pytest.raises(ValidationError, match="duplicate"):
        ConfirmSubstitutionRequest(**body)


def test_duplicate_confirmed_vehicle_ids_are_rejected() -> None:
    vehicle = _id()

    with pytest.raises(ValidationError, match="duplicate"):
        ConfirmSubstitutionRequest(**_confirm(confirmed_vehicle_ids=[vehicle, vehicle], seal_checks=[]))


def test_confirmation_must_name_at_least_one_vehicle() -> None:
    with pytest.raises(ValidationError):
        ConfirmSubstitutionRequest(**_confirm(confirmed_vehicle_ids=[], seal_checks=[]))


def test_seal_condition_for_substitutions_is_separate_from_the_phase_enum() -> None:
    assert {c.value for c in SubstitutionSealCondition} == {"intact", "damaged", "missing", "not_applicable"}
    assert {c.value for c in SealCondition} == {"intact", "damaged", "missing"}



@pytest.mark.parametrize(
    ("enum_name", "values"),
    [
        ("SubstitutionState", {"pending", "completed", "cancelled"}),
        ("SubstitutionRole", {"outgoing", "incoming"}),
        (
            "SubstitutionAction",
            {"confirm_outgoing", "confirm_incoming", "cancel", "replace", "complete_attested", "attest_identity"},
        ),
        (
            "SubstitutionCompletionBlocker",
            {"incoming_driver_inactive", "licence_invalid", "driver_unavailable", "identity_not_verified"},
        ),
        ("SubstitutionCompletionMode", {"normal", "dispatcher_attested"}),
        ("SubstitutionCompletionTrigger", {"driver_confirmation", "dispatcher_action"}),
        ("SubstitutionNoticeKind", {"arranged", "cancelled", "completed"}),
        ("DriverParticipation", {"current", "former"}),
        ("LateEvidenceStatus", {"awaiting_review", "acknowledged"}),
        ("LateEvidenceKind", {"phase", "checkpoint", "location", "exception"}),
        ("CustodyIntegrityStatus", {"verified", "pending", "failed"}),
    ],
)
def test_enum_values_match_the_contract(enum_name: str, values: set[str]) -> None:
    assert {member.value for member in getattr(ds, enum_name)} == values


@pytest.mark.parametrize("bad", ["Pending", "done", "", "PENDING"])
def test_invalid_state_is_rejected_on_a_request_read(bad: str) -> None:
    payload = _request_read_payload()
    payload["state"] = bad

    with pytest.raises(ValidationError):
        SubstitutionRequestRead(**payload)


def test_invalid_role_is_rejected_on_missing_confirmations() -> None:
    payload = _request_read_payload()
    payload["missing_confirmations"] = ["driver"]

    with pytest.raises(ValidationError):
        SubstitutionRequestRead(**payload)


def test_invalid_condition_is_rejected_on_a_seal_check() -> None:
    with pytest.raises(ValidationError):
        SealCheck(**_seal("torn"))



@pytest.mark.parametrize(
    "override",
    [
        {"label": ""},
        {"label": "x" * 256},
        {"instructions": "x" * 1001},
        {"latitude": 91},
        {"longitude": -180.5},
    ],
)
def test_exchange_point_bounds(override: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        ExchangePoint(**_exchange(**override))


def test_exchange_point_accepts_the_documented_limits() -> None:
    point = ExchangePoint(**_exchange(label="x" * 255, instructions="", latitude=-90, longitude=180))

    assert len(point.label) == 255


@pytest.mark.parametrize("reason", ["", "   ", "x" * 1001])
def test_arrange_reason_must_be_1_to_1000_characters(reason: str) -> None:
    with pytest.raises(ValidationError):
        ArrangeSubstitutionRequest(**_arrange(reason=reason))


def test_arrange_accepts_a_1000_character_reason() -> None:
    assert len(ArrangeSubstitutionRequest(**_arrange(reason="x" * 1000)).reason) == 1000


def test_replace_carries_the_complete_new_arrangement_and_its_own_reasons() -> None:
    body = {**_arrange(), "expected_version": 3, "replacement_reason": "Incoming driver ill"}

    request = ReplaceSubstitutionRequest(**body)

    assert request.replacement_reason == "Incoming driver ill"
    assert request.reason == "Driver hours limit reached"


@pytest.mark.parametrize("missing", ["replacement_reason", "reason", "exchange", "incoming_driver_id", "expected_at"])
def test_replace_requires_every_arrangement_field(missing: str) -> None:
    body = {**_arrange(), "expected_version": 3, "replacement_reason": "Incoming driver ill"}
    body.pop(missing)

    with pytest.raises(ValidationError):
        ReplaceSubstitutionRequest(**body)


@pytest.mark.parametrize("model", [CancelSubstitutionRequest])
@pytest.mark.parametrize("reason", ["", "   ", "x" * 1001])
def test_cancel_reason_is_bounded(model: type[BaseModel], reason: str) -> None:
    with pytest.raises(ValidationError):
        model(client_request_id=_id(), expected_version=1, reason=reason)


@pytest.mark.parametrize("field", ["reason", "correction_note"])
@pytest.mark.parametrize("value", ["", "  ", "x" * 1001])
def test_correction_text_is_1_to_1000_characters(field: str, value: str) -> None:
    body = {"client_request_id": _id(), "reason": "Typo in label", "correction_note": "Exchange label misspelt"}
    body[field] = value

    with pytest.raises(ValidationError):
        CorrectSubstitutionRequest(**body)


def test_oversized_discrepancy_note_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ConfirmSubstitutionRequest(**_confirm(discrepancy_note="x" * 1001))


def test_acknowledge_note_is_bounded() -> None:
    with pytest.raises(ValidationError):
        AcknowledgeLateEvidenceRequest(client_request_id=_id(), note="x" * 1001)


@pytest.mark.parametrize("field", ["missing_confirmation_reason", "identity_unavailable_reason"])
@pytest.mark.parametrize("value", ["", "   ", "x" * 1001])
def test_malformed_completion_reasons_are_rejected_not_ignored(field: str, value: str) -> None:
    body = {"client_request_id": _id(), "expected_version": 2, "missing_confirmation_reason": None,
            "identity_unavailable_reason": None, "declared_exchange_at": None}
    body[field] = value

    with pytest.raises(ValidationError):
        CompleteSubstitutionRequest(**body)


def test_null_completion_reasons_mean_no_attestation_was_requested() -> None:
    request = CompleteSubstitutionRequest(
        client_request_id=_id(), expected_version=2, missing_confirmation_reason=None,
        identity_unavailable_reason=None, declared_exchange_at=None,
    )

    assert request.identity_unavailable_reason is None
    assert request.missing_confirmation_reason is None


def test_completion_reason_is_trimmed() -> None:
    request = CompleteSubstitutionRequest(
        client_request_id=_id(), expected_version=2, missing_confirmation_reason="  phone dead ",
        identity_unavailable_reason=None, declared_exchange_at=None,
    )

    assert request.missing_confirmation_reason == "phone dead"


def test_expected_version_must_be_at_least_one() -> None:
    with pytest.raises(ValidationError):
        CancelSubstitutionRequest(client_request_id=_id(), expected_version=0, reason="x")



@pytest.mark.parametrize(
    ("model", "body", "field"),
    [
        (ArrangeSubstitutionRequest, _arrange(), "expected_at"),
        (ConfirmSubstitutionRequest, _confirm(), "captured_at"),
    ],
)
def test_naive_datetimes_are_rejected(model: type[BaseModel], body: dict[str, Any], field: str) -> None:
    body[field] = datetime(2026, 10, 20, 9, 0)

    with pytest.raises(ValidationError, match="timezone"):
        model(**body)


def test_naive_declared_exchange_time_is_rejected() -> None:
    with pytest.raises(ValidationError, match="timezone"):
        CompleteSubstitutionRequest(
            client_request_id=_id(), expected_version=1, missing_confirmation_reason=None,
            identity_unavailable_reason=None, declared_exchange_at=datetime(2026, 10, 20, 9, 0),
        )


@pytest.mark.parametrize("smuggled", ["driver_id", "actor_id", "user_id", "completed_by_user_id"])
def test_actor_ids_in_a_request_body_are_rejected(smuggled: str) -> None:
    with pytest.raises(ValidationError):
        ArrangeSubstitutionRequest(**_arrange(), **{smuggled: str(_id())})



def _in_transit_phase() -> dict[str, Any]:
    return {"phase_type": "in_transit", "idempotency_key": "q-1"}


def _late(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "client_request_id": _id(),
        "custody_sequence": 0,
        "captured_at": _NOW,
        "original_idempotency_key": None,
        "evidence": {"kind": kind, "payload": payload},
        "artifact_ids": [],
    }


_VALID_LATE_PAYLOADS = {
    "phase": _in_transit_phase(),
    "checkpoint": {"checkpoint_type": "routine"},
    "location": {"pings": [{"lat": -26.2, "lng": 28.0, "context": "transit", "recorded_at": _NOW}]},
    "exception": {"exception_type": "mechanical", "description": "Flat tyre on N3"},
}


@pytest.mark.parametrize("kind", sorted(_VALID_LATE_PAYLOADS))
def test_late_evidence_payload_kinds_embed_the_existing_request_schema(kind: str) -> None:
    request = LateEvidenceRequest(**_late(kind, _VALID_LATE_PAYLOADS[kind]))

    assert request.evidence.kind == kind


def test_late_evidence_unknown_kind_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LateEvidenceRequest(**_late("url", {"href": "https://example.com"}))


def test_late_evidence_payload_must_match_its_kind() -> None:
    with pytest.raises(ValidationError):
        LateEvidenceRequest(**_late("checkpoint", _in_transit_phase()))


def test_late_evidence_embedded_payload_keeps_the_existing_validation() -> None:
    bad_phase = {"phase_type": "in_transit", "idempotency_key": "q-1", "driver_phone_lat": 1.0}

    with pytest.raises(ValidationError):
        LateEvidenceRequest(**_late("phase", bad_phase))


def test_late_evidence_custody_sequence_is_not_negative() -> None:
    body = _late("phase", _in_transit_phase())
    body["custody_sequence"] = -1

    with pytest.raises(ValidationError):
        LateEvidenceRequest(**body)



def _driver(name: str = "Driver One") -> dict[str, Any]:
    return {"id": _id(), "full_name": name, "phone_number": "+27825550101"}


def _request_read_payload(**over: Any) -> dict[str, Any]:
    incoming = _driver("Driver Two")
    return {
        "id": _id(),
        "trip_id": _id(),
        "trip_reference": "TRP-TEST-0001",
        "version": 1,
        "state": "pending",
        "outgoing": _driver(),
        "incoming": incoming,
        "vehicles": [{"id": _id(), "registration": "TST 001 GP", "vehicle_type": "horse"}],
        "exchange": _exchange(),
        "expected_at": _NOW,
        "is_planned": True,
        "reason": "Hours limit",
        "created_at": _NOW,
        "confirmations": [],
        "identity": {"driver_id": incoming["id"], "status": "verified", "last_verified_at": _NOW, "observed_at": _NOW},
        "missing_confirmations": ["outgoing", "incoming"],
        "completed_substitution_id": None,
        "effective_at": None,
        "completion_mode": None,
        "completion_blocked_by": None,
        "replacement_request_id": None,
        "completion": None,
        "permitted_actions": ["cancel", "replace"],
        **over,
    }


def test_pending_request_read_round_trips() -> None:
    read = SubstitutionRequestRead(**_request_read_payload())

    assert read.state is ds.SubstitutionState.PENDING
    assert read.completion is None


def test_driver_contact_exposes_no_identity_or_licence_numbers() -> None:
    assert set(ds.DriverContact.model_fields) == {"id", "full_name", "phone_number"}


def test_completed_read_requires_its_completion_facts() -> None:
    with pytest.raises(ValidationError, match="completed"):
        SubstitutionRequestRead(**_request_read_payload(state="completed"))


def test_completed_read_with_all_completion_facts_is_accepted() -> None:
    read = SubstitutionRequestRead(
        **_request_read_payload(
            state="completed",
            missing_confirmations=[],
            completed_substitution_id=_id(),
            effective_at=_NOW,
            completion_mode="normal",
            completion={"trigger": "driver_confirmation", "completed_by_driver_id": _id(), "completed_by_user_id": None},
            permitted_actions=[],
        )
    )

    assert read.completion is not None
    assert read.completion.trigger is ds.SubstitutionCompletionTrigger.DRIVER_CONFIRMATION


def test_blocked_completion_is_only_valid_on_a_pending_request() -> None:
    with pytest.raises(ValidationError, match="completion_blocked_by"):
        SubstitutionRequestRead(**_request_read_payload(state="cancelled", completion_blocked_by="licence_invalid"))


def test_pending_request_may_report_why_completion_is_blocked() -> None:
    read = SubstitutionRequestRead(**_request_read_payload(completion_blocked_by="identity_not_verified"))

    assert read.completion_blocked_by is ds.SubstitutionCompletionBlocker.IDENTITY_NOT_VERIFIED


def test_replacement_reference_is_only_valid_on_a_cancelled_request() -> None:
    with pytest.raises(ValidationError, match="replacement_request_id"):
        SubstitutionRequestRead(**_request_read_payload(replacement_request_id=_id()))


@pytest.mark.parametrize(
    ("trigger", "driver_actor", "user_actor", "valid"),
    [
        ("driver_confirmation", True, False, True),
        ("dispatcher_action", False, True, True),
        ("driver_confirmation", False, True, False),
        ("dispatcher_action", True, False, False),
        ("driver_confirmation", True, True, False),
        ("dispatcher_action", False, False, False),
    ],
)
def test_completion_has_exactly_one_actor_matching_its_trigger(
    trigger: str, driver_actor: bool, user_actor: bool, valid: bool
) -> None:
    body = {
        "trigger": trigger,
        "completed_by_driver_id": _id() if driver_actor else None,
        "completed_by_user_id": _id() if user_actor else None,
    }

    if valid:
        SubstitutionCompletionRead(**body)
    else:
        with pytest.raises(ValidationError):
            SubstitutionCompletionRead(**body)


def test_custody_counts_cannot_be_negative() -> None:
    with pytest.raises(ValidationError):
        ds.CustodyIntegrityRead(status="pending", amendment_count=-1, pending_anchor_count=0, findings=[])


def test_driver_access_round_trips() -> None:
    access = ds.DriverAccess(participation="former", custody_sequence=1, can_advance=False, can_submit_late_evidence=True)

    assert access.participation is ds.DriverParticipation.FORMER


_MATRIX: list[tuple[str, str, int, str | None]] = [
    ("arrange_or_replace", "new arrangements disabled", 503, "SUBSTITUTIONS_DISABLED"),
    ("arrange_or_replace", "incoming account inactive", 409, "INCOMING_DRIVER_INACTIVE"),
    ("arrange_or_replace", "licence missing or expired", 409, "LICENCE_INVALID"),
    ("arrange_or_replace", "reservation conflict", 409, "DRIVER_UNAVAILABLE"),
    ("arrange_or_replace", "identity pending or failed", 201, None),
    ("driver_confirmation", "completed by final confirmation", 200, None),
    ("driver_confirmation", "saved but completion blocked", 200, None),
    ("dispatcher_complete", "all checks pass", 200, None),
    ("dispatcher_complete", "failed or unattested pending identity", 409, "IDENTITY_NOT_VERIFIED"),
    ("dispatcher_complete", "non-admin identity attestation attempt", 403, "IDENTITY_ATTESTATION_FORBIDDEN"),
    ("dispatcher_complete", "incoming inactive", 409, "INCOMING_DRIVER_INACTIVE"),
    ("dispatcher_complete", "licence invalid", 409, "LICENCE_INVALID"),
    ("dispatcher_complete", "reservation conflict", 409, "DRIVER_UNAVAILABLE"),
    ("confirm_cancel_replace_complete", "request version changed", 409, "SUBSTITUTION_VERSION_CHANGED"),
    ("confirm_cancel_replace_complete", "request no longer pending", 409, "SUBSTITUTION_NOT_PENDING"),
    ("idempotent_mutation", "same key with changed body", 409, "IDEMPOTENCY_KEY_REUSED"),
    ("live_trip_write", "former actor", 409, "TRIP_HANDED_OVER"),
    ("live_trip_write", "stale custody sequence", 409, "CUSTODY_CONTEXT_CHANGED"),
    ("live_trip_write", "custody sequence missing after a transfer", 409, "CUSTODY_CONTEXT_REQUIRED"),
    ("live_trip_write", "proven exact replay after transfer", 409, "EVIDENCE_ALREADY_RECORDED"),
]


@pytest.mark.parametrize(("endpoint", "outcome", "status", "code"), _MATRIX, ids=lambda v: str(v)[:40])
def test_every_endpoint_outcome_row_maps_to_a_status_and_code(
    endpoint: str, outcome: str, status: int, code: str | None
) -> None:
    if code is None:
        assert status in (200, 201), f"{endpoint}/{outcome}: a codeless row must be a success"
        return

    assert SubstitutionErrorCode(code) in ds.SUBSTITUTION_ERROR_STATUS
    assert ds.SUBSTITUTION_ERROR_STATUS[SubstitutionErrorCode(code)] == status


def test_every_error_code_in_the_contract_has_a_status() -> None:
    assert {c.value for c in SubstitutionErrorCode} == {
        "TRIP_HANDED_OVER", "CUSTODY_CONTEXT_CHANGED", "CUSTODY_CONTEXT_REQUIRED",
        "SUBSTITUTION_VERSION_CHANGED", "SUBSTITUTION_NOT_PENDING", "DRIVER_UNAVAILABLE",
        "INCOMING_DRIVER_INACTIVE", "LICENCE_INVALID", "IDENTITY_ATTESTATION_FORBIDDEN",
        "IDENTITY_NOT_VERIFIED", "IDEMPOTENCY_KEY_REUSED", "EVIDENCE_ALREADY_RECORDED",
        "SUBSTITUTIONS_DISABLED",
    }
    assert set(ds.SUBSTITUTION_ERROR_STATUS) == set(SubstitutionErrorCode)


def test_only_two_codes_are_not_conflicts() -> None:
    non_conflicts = {c.value: s for c, s in ds.SUBSTITUTION_ERROR_STATUS.items() if s != 409}

    assert non_conflicts == {"IDENTITY_ATTESTATION_FORBIDDEN": 403, "SUBSTITUTIONS_DISABLED": 503}


def test_error_detail_carries_optional_context() -> None:
    detail = ds.SubstitutionErrorDetail(
        code="SUBSTITUTION_VERSION_CHANGED", message="Refetch", request_id=_id(), current_version=4
    )

    assert detail.evidence_id is None
    assert ds.SubstitutionErrorResponse(detail=detail).detail.current_version == 4


_REPO = Path(__file__).resolve().parents[3]
_TS_TYPES = _REPO / "frontend" / "shared" / "lib" / "types" / "driver-substitution.ts"

_PARITY_MODELS: dict[str, type[BaseModel]] = {
    "DriverContact": ds.DriverContact,
    "ExchangePoint": ds.ExchangePoint,
    "VehicleRef": ds.VehicleRef,
    "SealCheck": ds.SealCheck,
    "IdentitySnapshot": ds.IdentitySnapshot,
    "ConfirmationSummary": ds.ConfirmationSummary,
    "SubstitutionRequestRead": ds.SubstitutionRequestRead,
    "SubstitutionCompletionRead": ds.SubstitutionCompletionRead,
    "CustodyIntegrityRead": ds.CustodyIntegrityRead,
    "DriverAccess": ds.DriverAccess,
    "SubstitutionNoticeRead": ds.SubstitutionNoticeRead,
    "SubstitutionCorrectionRead": ds.SubstitutionCorrectionRead,
    "LateEvidenceRead": ds.LateEvidenceRead,
    "ArrangeSubstitutionRequest": ds.ArrangeSubstitutionRequest,
    "CancelSubstitutionRequest": ds.CancelSubstitutionRequest,
    "ReplaceSubstitutionRequest": ds.ReplaceSubstitutionRequest,
    "ConfirmSubstitutionRequest": ds.ConfirmSubstitutionRequest,
    "CompleteSubstitutionRequest": ds.CompleteSubstitutionRequest,
    "CorrectSubstitutionRequest": ds.CorrectSubstitutionRequest,
    "LateEvidenceRequest": ds.LateEvidenceRequest,
    "AcknowledgeLateEvidenceRequest": ds.AcknowledgeLateEvidenceRequest,
    "SubstitutionErrorDetail": ds.SubstitutionErrorDetail,
    "DriverSubstitutionContextRead": ds.DriverSubstitutionContextRead,
    "DriverParticipationHistoryRead": ds.DriverParticipationHistoryRead,
    "LateEvidenceDetailRead": ds.LateEvidenceDetailRead,
}

_PARITY_ENUMS: dict[str, type[enum.Enum]] = {
    "SubstitutionState": ds.SubstitutionState,
    "SubstitutionRole": ds.SubstitutionRole,
    "SubstitutionSealCondition": ds.SubstitutionSealCondition,
    "SubstitutionAction": ds.SubstitutionAction,
    "SubstitutionCompletionMode": ds.SubstitutionCompletionMode,
    "SubstitutionCompletionTrigger": ds.SubstitutionCompletionTrigger,
    "SubstitutionCompletionBlocker": ds.SubstitutionCompletionBlocker,
    "SubstitutionNoticeKind": ds.SubstitutionNoticeKind,
    "DriverParticipation": ds.DriverParticipation,
    "LateEvidenceStatus": ds.LateEvidenceStatus,
    "LateEvidenceKind": ds.LateEvidenceKind,
    "CustodyIntegrityStatus": ds.CustodyIntegrityStatus,
    "SubstitutionErrorCode": ds.SubstitutionErrorCode,
}


def _ts_source() -> str:
    if not _TS_TYPES.exists():
        pytest.skip("frontend/shared not present in this checkout")
    return _TS_TYPES.read_text()


def _ts_interface_fields(source: str, name: str) -> set[str]:
    """Top-level property names of `export interface Name ... { }` (extends excluded).

    Parsed line-wise, so the interface bodies in the shared file keep one property per line
    at two-space indent and use no inline object types."""
    match = re.search(rf"export interface {name}\b[^{{]*\{{(.*?)^\}}", source, re.S | re.M)
    assert match, f"interface {name} missing from driver-substitution.ts"
    return set(re.findall(r"^  ([a-z_0-9]+)\??:", match.group(1), re.M))


def _ts_extends(source: str, name: str) -> list[str]:
    match = re.search(rf"export interface {name}\b([^{{]*)\{{", source)
    assert match
    clause = match.group(1)
    if "extends" not in clause:
        return []
    return re.findall(r"(?:Omit<)?([A-Za-z]+)", clause.split("extends", 1)[1].split("{")[0])[:1]


def _all_ts_fields(source: str, name: str) -> set[str]:
    fields = _ts_interface_fields(source, name)
    for parent in _ts_extends(source, name):
        fields |= _all_ts_fields(source, parent)
    return fields


@pytest.mark.parametrize("name", sorted(_PARITY_MODELS))
def test_typescript_interface_has_exactly_the_pydantic_fields(name: str) -> None:
    source = _ts_source()

    assert _all_ts_fields(source, name) == set(_PARITY_MODELS[name].model_fields), name


@pytest.mark.parametrize("name", sorted(_PARITY_ENUMS))
def test_typescript_union_has_exactly_the_python_enum_values(name: str) -> None:
    source = _ts_source()
    match = re.search(rf"export type {name} =([^;]*?)(?=\nexport |\n\n|\Z)", source, re.S)
    assert match, f"type {name} missing from driver-substitution.ts"

    assert set(re.findall(r"'([A-Za-z_]+)'", match.group(1))) == {m.value for m in _PARITY_ENUMS[name]}


def test_typescript_error_status_table_matches_python() -> None:
    source = _ts_source()
    block = re.search(r"SUBSTITUTION_ERROR_STATUS[^{]*\{(.*?)\}", source, re.S)
    assert block, "SUBSTITUTION_ERROR_STATUS missing from driver-substitution.ts"

    ts_table = {code: int(status) for code, status in re.findall(r"([A-Z_]+):\s*(\d{3})", block.group(1))}

    assert ts_table == {c.value: s for c, s in ds.SUBSTITUTION_ERROR_STATUS.items()}


def test_immediate_arrangement_has_no_planning_fields():
    body = ds.ArrangeImmediateSubstitutionRequest(client_request_id=_id(), request_format='immediate_v2', incoming_driver_id=_id(), reason=' Relief ')
    assert body.reason == 'Relief'
    assert set(body.model_dump()) == {'client_request_id', 'request_format', 'incoming_driver_id', 'reason'}
    with pytest.raises(ValidationError):
        ds.ArrangeImmediateSubstitutionRequest(**body.model_dump(), expected_at='2026-10-20T10:00:00+02:00')
