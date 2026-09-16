"""The substitution defence: does the vendor's extracted identity agree with what the
receiver typed? A single-use session link stops replay, never a confederate completing
the flow with their own genuine document."""

from app.orchestration.receiver_verification_service import identity_matches


def test_matching_surname_and_id_number_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    ) is True


def test_comparison_ignores_case_whitespace_and_diacritics():
    assert identity_matches(
        typed_name="  josé  MÜLLER ",
        typed_id_number=" 9202204720082 ",
        extracted_surname="Muller",
        extracted_id_number="9202-204-720082",
    ) is True


def test_a_different_id_number_does_not_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="8801015800085",
    ) is False


def test_a_different_surname_does_not_match():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname="Dlamini",
        extracted_id_number="9202204720082",
    ) is False


def test_surname_matches_any_token_of_the_typed_name():
    """Given-name ordering and initials vary too much between a document and self-entry
    to carry a signal, so only the surname is required to appear."""
    assert identity_matches(
        typed_name="Nkosi, Thandi Grace",
        typed_id_number="9202204720082",
        extracted_surname="Nkosi",
        extracted_id_number="9202204720082",
    ) is True


def test_no_extracted_data_is_unknown_not_a_mismatch():
    assert identity_matches(
        typed_name="Thandi Nkosi",
        typed_id_number="9202204720082",
        extracted_surname=None,
        extracted_id_number=None,
    ) is None
