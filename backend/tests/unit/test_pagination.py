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
    position = CursorPosition(created_at=datetime(2026, 9, 6, tzinfo=UTC), id=uuid4())

    decoded = decode_cursor(encode_cursor(position))

    assert decoded == position


@pytest.mark.parametrize("value", ["", "not-base64", "e30="])
def test_cursor_rejects_malformed_values(value: str) -> None:
    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_round_trip_preserves_microsecond_precision() -> None:
    position = CursorPosition(
        created_at=datetime(2026, 9, 6, 12, 34, 56, 789123, tzinfo=UTC), id=uuid4()
    )

    decoded = decode_cursor(encode_cursor(position))

    assert decoded == position


def test_cursor_rejects_json_missing_created_at_key() -> None:
    value = _encode_json_payload({"id": str(uuid4())})

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_json_missing_id_key() -> None:
    value = _encode_json_payload({"created_at": "2026-09-06T00:00:00+00:00"})

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_naive_timestamp() -> None:
    value = _encode_json_payload(
        {"created_at": "2026-09-06T00:00:00", "id": str(uuid4())}
    )

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_invalid_uuid() -> None:
    value = _encode_json_payload(
        {"created_at": "2026-09-06T00:00:00+00:00", "id": "not-a-uuid"}
    )

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_unparseable_timestamp() -> None:
    value = _encode_json_payload(
        {"created_at": "not-a-timestamp", "id": str(uuid4())}
    )

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_non_dict_json_payload() -> None:
    value = _encode_json_payload([1, 2, 3])

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_rejects_junk_characters_spliced_into_valid_base64() -> None:
    position = CursorPosition(created_at=datetime(2026, 9, 6, tzinfo=UTC), id=uuid4())
    clean = encode_cursor(position)
    midpoint = len(clean) // 2
    spliced = clean[:midpoint] + "!!!###@@@   \n\t" + clean[midpoint:]

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(spliced)


def test_cursor_rejects_deeply_nested_json_without_recursion_error() -> None:
    deeply_nested_json = ("[" * 10_000) + ("]" * 10_000)
    value = base64.urlsafe_b64encode(deeply_nested_json.encode()).decode()

    with pytest.raises(ValueError, match="Invalid pagination cursor"):
        decode_cursor(value)


def test_cursor_page_constructs_with_valid_fields() -> None:
    page: CursorPage[str] = CursorPage(items=["a", "b"], next_cursor="abc", total_items=2)

    assert page.items == ["a", "b"]
    assert page.next_cursor == "abc"
    assert page.total_items == 2


def test_cursor_page_rejects_negative_total_items() -> None:
    with pytest.raises(ValidationError):
        CursorPage[str](items=[], next_cursor=None, total_items=-1)
