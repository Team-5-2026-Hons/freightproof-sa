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


def _surname_matches(typed_name: str, surname: str) -> bool | None:
    """Surname-only comparison: the id number is held equal so only the name decides."""
    return identity_matches(
        typed_name=typed_name,
        typed_id_number="9202204720082",
        extracted_surname=surname,
        extracted_id_number="9202204720082",
    )


def test_compound_surname_matches_as_a_contiguous_run_of_typed_tokens():
    assert _surname_matches("Pieter van der Merwe", "van der Merwe") is True


def test_hyphenated_surname_matches_when_typed_hyphenated():
    assert _surname_matches("Anna Smith-Jones", "Smith-Jones") is True


def test_hyphenated_surname_matches_when_typed_with_a_space():
    assert _surname_matches("Anna Smith Jones", "Smith-Jones") is True


def test_compound_surname_with_a_missing_particle_does_not_match():
    assert _surname_matches("Pieter Merwe", "van der Merwe") is False


def test_surname_must_match_whole_tokens_not_substrings():
    assert _surname_matches("Merwenstein", "Merwe") is False


def test_compound_surname_with_a_different_particle_does_not_match():
    assert _surname_matches("Pieter van Merwe", "van der Merwe") is False


def test_compound_surname_tokens_out_of_order_do_not_match():
    assert _surname_matches("Pieter Merwe van der", "van der Merwe") is False


def test_blank_extracted_surname_never_matches():
    assert _surname_matches("Pieter van der Merwe", "  ") is False
