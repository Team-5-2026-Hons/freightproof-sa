"""Unit tests for user-input constraints (app/schemas/text.py and the schemas using it).

Two classes of problem, both of which existed on every free-text field before:

  * An unbounded string reached Postgres, where a String(n) column raised
    StringDataRightTruncation — surfacing to the caller as a 500. A validation failure
    reported as a server error tells the caller we broke, not that they did.
  * Characters that make stored text render as something other than what is stored. On a
    platform whose product IS the integrity of a record, that is the whole game.
"""

import pytest
from pydantic import ValidationError

from app.schemas.people import DriverCreateBody
from app.schemas.text import (
    FREE_TEXT_MAX_LENGTH,
    NAME_MAX_LENGTH,
    clean_text,
)
from app.schemas.transit import DriverCheckpointCreateBody, DriverExceptionCreateBody
from app.schemas.trips import CancelTripRequest, TripStopCreate

_VALID_ID_NUMBER = "8001015009087"


# ── The cleaner ──────────────────────────────────────────────────────────────


def test_a_bidi_override_is_stripped() -> None:
    """The Trojan Source trick, pointed at an audit trail: an override character makes
    the text a dispatcher reads differ from the bytes on record."""
    assert clean_text("cargo intact‮reversed") == "cargo intactreversed"


def test_zero_width_characters_are_stripped() -> None:
    assert clean_text("a​b‌‍c") == "abc"


def test_control_characters_are_stripped() -> None:
    assert clean_text("\x00\x07bad\x1f") == "bad"


def test_newlines_and_tabs_survive() -> None:
    """A multi-line account of what happened at a depot gate is legitimate evidence."""
    assert clean_text("line one\nline two\tindented") == "line one\nline two\tindented"


def test_ordinary_punctuation_is_untouched() -> None:
    """This is not an HTML or SQL sanitiser and must never become one — SQLAlchemy's
    parameter binding and React's escaping own those. Stripping here would silently
    corrupt legitimate content."""
    assert clean_text("Smith & Sons <depot> 100% 'quoted'") == "Smith & Sons <depot> 100% 'quoted'"


def test_surrounding_whitespace_is_trimmed_but_interior_is_kept() -> None:
    assert clean_text("  two   spaces  ") == "two   spaces"


# ── Length ceilings ──────────────────────────────────────────────────────────


def test_an_over_length_exception_description_is_a_422_not_a_500() -> None:
    """description lands on a TEXT column with no width of its own — before this, one
    authenticated driver could write as much as they liked."""
    with pytest.raises(ValidationError):
        DriverExceptionCreateBody(
            exception_type="cargo_damage", description="x" * (FREE_TEXT_MAX_LENGTH + 1),
        )


def test_an_over_length_checkpoint_type_is_rejected() -> None:
    """checkpoint_type lands on String(50). Postgres used to be the one rejecting this,
    as a 500."""
    with pytest.raises(ValidationError):
        DriverCheckpointCreateBody(checkpoint_type="x" * 51)


def test_an_over_length_driver_name_is_rejected() -> None:
    with pytest.raises(ValidationError):
        DriverCreateBody(
            full_name="x" * (NAME_MAX_LENGTH + 1), id_number=_VALID_ID_NUMBER,
            phone_number="+27821234567", license_number="DRV-1",
        )


def test_an_over_length_stop_note_is_rejected() -> None:
    import uuid

    with pytest.raises(ValidationError):
        TripStopCreate(precinct_id=uuid.uuid4(), sequence=0, notes="x" * 256)


def test_padding_cannot_smuggle_a_value_past_the_ceiling() -> None:
    """The ceiling is applied BEFORE cleaning, so a caller cannot pad to the limit with
    characters that are then stripped away."""
    with pytest.raises(ValidationError):
        DriverExceptionCreateBody(
            exception_type="cargo_damage",
            description="​" * (FREE_TEXT_MAX_LENGTH + 1),
        )


# ── Required narrative ───────────────────────────────────────────────────────


def test_a_note_of_only_invisible_characters_is_refused() -> None:
    """min_length alone cannot catch this: two zero-width spaces are two characters to a
    length check and nothing at all to a reader. A cancellation with an unreadable reason
    is the audit gap the required note exists to prevent."""
    with pytest.raises(ValidationError):
        CancelTripRequest(note="​​")


def test_a_real_note_is_accepted_and_cleaned() -> None:
    assert CancelTripRequest(note="  cargo pulled by client  ").note == "cargo pulled by client"


# ── GPS bounds ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("driver_phone_lat", 91.0),
        ("driver_phone_lat", -91.0),
        ("driver_phone_lng", 181.0),
        ("horse_gps_lat", 91.0),
        ("horse_gps_lng", -181.0),
    ],
)
def test_out_of_range_checkpoint_coordinates_are_rejected(field: str, value: float) -> None:
    """The exception body already enforced these; the checkpoint body did not, so a
    nonsense coordinate could land on an evidence record and never be plottable."""
    pair = {"driver_phone_lat": 0.0, "driver_phone_lng": 0.0,
            "horse_gps_lat": 0.0, "horse_gps_lng": 0.0}
    pair[field] = value

    with pytest.raises(ValidationError):
        DriverCheckpointCreateBody(checkpoint_type="manual", **pair)


def test_half_a_checkpoint_fix_is_rejected_and_names_the_pair() -> None:
    """A checkpoint carries two independent fixes, so the error has to say which one was
    half-supplied."""
    with pytest.raises(ValidationError, match="horse_gps"):
        DriverCheckpointCreateBody(checkpoint_type="manual", horse_gps_lat=-33.9)


def test_a_valid_checkpoint_still_passes() -> None:
    """The constraints must not have broken the ordinary path."""
    body = DriverCheckpointCreateBody(
        checkpoint_type="manual", driver_phone_lat=-33.9249, driver_phone_lng=18.4241,
        note="fuel stop",
    )

    assert body.checkpoint_type == "manual"
    assert body.note == "fuel stop"
