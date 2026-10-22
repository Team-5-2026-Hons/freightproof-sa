"""Typed words → one record or candidates (assistant spec D2b): the pure matcher, no database."""

import uuid

import pytest

from app.orchestration.assistant.resolve import (
    MAX_CANDIDATES,
    Candidate,
    match_codes,
    match_names,
    match_precincts,
    normalise_code,
    normalise_name,
)


def _driver(name: str, *, active: bool = True) -> Candidate:
    return Candidate("driver", uuid.uuid4(), name, active)


def _vehicle(registration: str) -> Candidate:
    return Candidate("vehicle", uuid.uuid4(), registration, True, "horse")


def _depot(name: str, hub: str | None = None) -> Candidate:
    return Candidate("precinct", uuid.uuid4(), name, True, hub)


TIM = _driver("Tim Giltig")
TIMOTHY = _driver("Timothy Nkosi")
SIPHO = _driver("Sipho Mokoena")
TIM_NKOSI = _driver("Tim Nkosi")


def test_normalise_name_and_code() -> None:
    assert normalise_name("  Tim   GILTIG! ") == "tim giltig"
    assert normalise_code("ca 123-456") == "CA123456"


@pytest.mark.parametrize("typed", ["Tim Giltig", "tim giltig", "TIM  GILTIG", "Giltig", "Tim G"])
def test_match_names_finds_the_one_driver(typed: str) -> None:
    resolution = match_names(typed, [TIM, SIPHO])

    assert resolution.status == "found"
    assert resolution.match == TIM


def test_match_names_first_name_shared_by_two_is_ambiguous() -> None:
    resolution = match_names("Tim", [TIM, TIMOTHY, SIPHO])

    assert resolution.status == "ambiguous"
    assert set(resolution.candidates) == {TIM, TIMOTHY}
    assert resolution.match is None


def test_match_names_exact_beats_a_longer_name_sharing_its_words() -> None:
    resolution = match_names("Tim Giltig", [TIM, _driver("Tim Giltig Jnr")])

    assert resolution.match == TIM


def test_match_names_two_people_with_the_same_name_are_ambiguous() -> None:
    twin = _driver("Tim Giltig")

    resolution = match_names("tim giltig", [TIM, twin])

    assert resolution.status == "ambiguous"


@pytest.mark.parametrize("typed", ["Tim Giltg", "Giltg", "Tim Giltiig"])
def test_match_names_close_spelling_is_found(typed: str) -> None:
    resolution = match_names(typed, [TIM, SIPHO])

    assert resolution.match == TIM


def test_match_names_short_first_name_and_a_slip_in_the_surname() -> None:
    timothy = _driver("Timothy Gultig")

    resolution = match_names("Tim Giltig", [timothy, SIPHO, TIM_NKOSI])

    assert resolution.match == timothy


@pytest.mark.parametrize("typed", ["Tom Gilbert", "Nobody", "", "   "])
def test_match_names_different_or_blank_is_not_found(typed: str) -> None:
    resolution = match_names(typed, [TIM, SIPHO])

    assert resolution.status == "not_found"


def test_match_names_keeps_an_inactive_driver_marked() -> None:
    gone = _driver("Anna Kruger", active=False)

    resolution = match_names("Anna", [gone, TIM])

    assert resolution.match == gone
    assert resolution.match is not None and not resolution.match.is_active


def test_match_names_caps_candidates_and_counts_the_rest() -> None:
    many = [_driver(f"Tim Number{index}") for index in range(MAX_CANDIDATES + 3)]

    resolution = match_names("Tim", many)

    assert len(resolution.candidates) == MAX_CANDIDATES
    assert resolution.more == 3


@pytest.mark.parametrize("typed", ["CA 123-456", "ca123456", "CA-123 456", "123456", "CA123465"])
def test_match_codes_registration_forms_and_one_slip(typed: str) -> None:
    truck = _vehicle("CA 123-456")

    resolution = match_codes(typed, [truck, _vehicle("GP 987-654")], fuzzy=True)

    assert resolution.match == truck


def test_match_codes_short_fragment_is_not_found() -> None:
    resolution = match_codes("12", [_vehicle("CA 123-456"), _vehicle("CA 124-456")], fuzzy=True)

    assert resolution.status == "not_found"


def test_match_codes_trip_suffix_matches_but_a_slip_does_not() -> None:
    trip = Candidate("trip", uuid.uuid4(), "FP-20261020-AB12CD34")

    by_suffix = match_codes("ab12cd34", [trip], fuzzy=False)
    by_slip = match_codes("FP-20261020-AB12CD35", [trip], fuzzy=False)

    assert by_suffix.match == trip
    assert by_slip.status == "not_found"


def test_match_precincts_by_name_hub_code_and_city() -> None:
    city_deep = _depot("City Deep Depot", "JNB")
    cape = _depot("Epping Hub", "CPT")
    addresses = {city_deep.id: "1 Rail Rd, City Deep, Johannesburg", cape.id: "Epping, Cape Town"}

    assert match_precincts("City Deep", [city_deep, cape], addresses).match == city_deep
    assert match_precincts("CPT", [city_deep, cape], addresses).match == cape
    assert match_precincts("Joburg", [city_deep, cape], addresses).match == city_deep
    assert match_precincts("Cape Town", [city_deep, cape], addresses).match == cape


def test_match_precincts_city_with_two_depots_is_ambiguous() -> None:
    city_deep = _depot("City Deep Depot")
    midrand = _depot("Midrand Johannesburg DC")
    addresses = {city_deep.id: "City Deep, Johannesburg", midrand.id: ""}

    resolution = match_precincts("Jozi", [city_deep, midrand], addresses)

    assert resolution.status == "ambiguous"
    assert set(resolution.candidates) == {city_deep, midrand}


def test_match_precincts_unknown_place_is_not_found() -> None:
    resolution = match_precincts("Durban", [_depot("City Deep Depot")], {})

    assert resolution.status == "not_found"
