"""Unit tests for app.core.pagination — opaque cursor encode/decode, no DB, no HTTP.

Every malformed input collapses to the same ValueError("Invalid pagination cursor"):
callers must not be able to distinguish "bad base64" from "bad JSON" from "wrong
shape" from the error message alone, since that would leak internal encoding
details to an API client probing the cursor parameter.
"""

import base64
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.core.pagination import (
    CursorPosition,
    _encode_json_payload,
    decode_cursor,
    encode_cursor,
)
from app.schemas.pagination import CursorPage
from uuid import uuid4


def test_cursor_round_trip_preserves_timestamp_and_uuid() -> None:
    # Arrange
    position = CursorPosition(created_at=datetime(2026, 9, 6, tzinfo=UTC), id=uuid4())

    # Act
    decoded = decode_cursor(encode_cursor(position))

    # Assert
    assert decoded == position


@pytest.mark.parametrize("value", ["", "not-base64", "e30="])
def test_cursor_rejects_malformed_values(value: str) -> None:
    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_round_trip_preserves_microsecond_precision() -> None:
    # Arrange: created_at is a DB timestamp and can carry microsecond precision —
    # a lossy encoding here would let two distinct rows collapse onto the same
    # cursor and silently skip or repeat a page boundary.
    position = CursorPosition(
        created_at=datetime(2026, 9, 6, 12, 34, 56, 789123, tzinfo=UTC), id=uuid4()
    )

    # Act
    decoded = decode_cursor(encode_cursor(position))

    # Assert
    assert decoded == position


def test_cursor_rejects_json_missing_created_at_key() -> None:
    # Arrange: valid base64, valid JSON, but the shape is wrong.
    value = _encode_json_payload({"id": str(uuid4())})

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_json_missing_id_key() -> None:
    # Arrange
    value = _encode_json_payload({"created_at": "2026-09-06T00:00:00+00:00"})

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_naive_timestamp() -> None:
    # Arrange: a naive created_at would silently compare as UTC downstream and
    # manufacture a wrong page boundary rather than fail loudly.
    value = _encode_json_payload(
        {"created_at": "2026-09-06T00:00:00", "id": str(uuid4())}
    )

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_invalid_uuid() -> None:
    # Arrange
    value = _encode_json_payload(
        {"created_at": "2026-09-06T00:00:00+00:00", "id": "not-a-uuid"}
    )

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_unparseable_timestamp() -> None:
    # Arrange
    value = _encode_json_payload(
        {"created_at": "not-a-timestamp", "id": str(uuid4())}
    )

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_non_dict_json_payload() -> None:
    # Arrange: valid base64, valid JSON (a bare list), but not an object at all.
    value = _encode_json_payload([1, 2, 3])

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_junk_characters_spliced_into_valid_base64() -> None:
    # Arrange: base64.urlsafe_b64decode without validate=True silently discards
    # any character outside the base64 alphabet before decoding, so a cursor with
    # junk spliced into the middle would otherwise decode to the exact original
    # position instead of failing — invisible corruption/tampering of an
    # untrusted, client-supplied query parameter.
    position = CursorPosition(created_at=datetime(2026, 9, 6, tzinfo=UTC), id=uuid4())
    clean = encode_cursor(position)
    midpoint = len(clean) // 2
    spliced = clean[:midpoint] + "!!!###@@@   \n\t" + clean[midpoint:]

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(spliced)


def test_cursor_rejects_deeply_nested_json_without_recursion_error() -> None:
    # Arrange: a ~26KB value of nothing but "[" repeated blows json.loads()'s
    # recursion limit and raises RecursionError, not ValueError — the reviewer's
    # exact repro. This must be caught by the length cap (_MAX_CURSOR_LENGTH)
    # before json.loads() is ever called, and must never surface as an
    # uncaught RecursionError/500 from a client-supplied query parameter.
    deeply_nested_json = ("[" * 10_000) + ("]" * 10_000)
    value = base64.urlsafe_b64encode(deeply_nested_json.encode()).decode()

    # Act / Assert
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_page_constructs_with_valid_fields() -> None:
    # Arrange / Act
    page: CursorPage[str] = CursorPage(items=["a", "b"], next_cursor="abc", total_items=2)

    # Assert
    assert page.items == ["a", "b"]
    assert page.next_cursor == "abc"
    assert page.total_items == 2


def test_cursor_page_rejects_negative_total_items() -> None:
    # Act / Assert
    with pytest.raises(ValidationError):
        CursorPage[str](items=[], next_cursor=None, total_items=-1)
