"""FP-83 C3 CP4: the pure per-vehicle comparison of the two drivers' seal captures."""

import uuid

import pytest

from app.db.models.enums import ExceptionType
from app.orchestration.substitutions.seal_comparison import compare_seal_captures
from app.schemas.driver_substitutions import SealCheck, SubstitutionSealCondition

PHOTO = uuid.uuid4()


def intact(vehicle_id: uuid.UUID, number: str = "AB-1234") -> SealCheck:
    return SealCheck(
        vehicle_id=vehicle_id, condition=SubstitutionSealCondition.INTACT, seal_number=number,
        photo_artifact_ids=[uuid.uuid4()],
    )


def broken(vehicle_id: uuid.UUID, condition: SubstitutionSealCondition, number: str | None = "AB-1234") -> SealCheck:
    return SealCheck(
        vehicle_id=vehicle_id, condition=condition,
        seal_number=None if condition is SubstitutionSealCondition.MISSING else number,
        photo_artifact_ids=[uuid.uuid4()],
    )


def not_applicable(vehicle_id: uuid.UUID) -> SealCheck:
    return SealCheck(
        vehicle_id=vehicle_id, condition=SubstitutionSealCondition.NOT_APPLICABLE,
        not_applicable_reason="Empty leg",
    )


def test_matching_intact_seals_raise_nothing():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(outgoing=[intact(vehicle)], incoming=[intact(vehicle)])

    assert findings == []


def test_both_not_applicable_raises_nothing():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(outgoing=[not_applicable(vehicle)], incoming=[not_applicable(vehicle)])

    assert findings == []


def test_different_numbers_are_a_seal_mismatch_naming_both_readings():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(outgoing=[intact(vehicle, "AB-1234")], incoming=[intact(vehicle, "AB-9999")])

    assert [(f.vehicle_id, f.exception_type) for f in findings] == [(vehicle, ExceptionType.SEAL_MISMATCH)]
    assert "AB-1234" in findings[0].description and "AB-9999" in findings[0].description


@pytest.mark.parametrize("condition", [SubstitutionSealCondition.DAMAGED, SubstitutionSealCondition.MISSING])
def test_a_broken_seal_on_either_side_is_compromised(condition: SubstitutionSealCondition):
    vehicle = uuid.uuid4()

    as_outgoing = compare_seal_captures(outgoing=[broken(vehicle, condition)], incoming=[intact(vehicle)])
    as_incoming = compare_seal_captures(outgoing=[intact(vehicle)], incoming=[broken(vehicle, condition)])

    for findings in (as_outgoing, as_incoming):
        assert ExceptionType.SEAL_COMPROMISED in [f.exception_type for f in findings]
        assert condition.value in next(
            f.description for f in findings if f.exception_type is ExceptionType.SEAL_COMPROMISED
        )


def test_damage_seen_by_both_drivers_is_one_compromised_finding():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(
        outgoing=[broken(vehicle, SubstitutionSealCondition.DAMAGED)],
        incoming=[broken(vehicle, SubstitutionSealCondition.DAMAGED)],
    )

    assert [f.exception_type for f in findings] == [ExceptionType.SEAL_COMPROMISED]


def test_a_broken_seal_with_a_different_number_records_both_findings():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(
        outgoing=[intact(vehicle, "AB-1234")],
        incoming=[broken(vehicle, SubstitutionSealCondition.DAMAGED, "AB-9999")],
    )

    assert sorted(f.exception_type.value for f in findings) == ["seal_compromised", "seal_mismatch"]


def test_one_driver_answering_not_applicable_against_a_read_seal_is_a_mismatch():
    vehicle = uuid.uuid4()

    findings = compare_seal_captures(outgoing=[not_applicable(vehicle)], incoming=[intact(vehicle)])

    assert [f.exception_type for f in findings] == [ExceptionType.SEAL_MISMATCH]
    assert "not applicable" in findings[0].description


def test_findings_come_back_in_a_deterministic_vehicle_order():
    first, second = sorted([uuid.uuid4(), uuid.uuid4()], key=str)

    findings = compare_seal_captures(
        outgoing=[intact(second, "AB-0001"), intact(first, "AB-0002")],
        incoming=[intact(first, "AB-0003"), intact(second, "AB-0004")],
    )

    assert [f.vehicle_id for f in findings] == [first, second]


def test_captures_covering_different_vehicles_are_a_caller_error():
    with pytest.raises(ValueError):
        compare_seal_captures(outgoing=[intact(uuid.uuid4())], incoming=[intact(uuid.uuid4())])
