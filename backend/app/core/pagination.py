"""Opaque cursor primitives for keyset (cursor-based) pagination.

A cursor identifies a row's `(created_at, id)` position; the `id` tie-break
matters because `created_at` alone isn't unique. Carries no filter state or
PII, so it's safe to log and hand back to any caller.

Callers must treat `encode_cursor`/`decode_cursor` as the only door in and
out — never construct or introspect a cursor directly, since the wire format
may change without notice.
"""

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

# One message for every failure mode, so a client probing the cursor param
# can't learn which decode layer it broke through.
_INVALID_CURSOR_MESSAGE = "Invalid pagination cursor"

# Generous headroom above a real cursor's ~80-110 bytes. Rejects grossly
# oversized input (e.g. deeply-nested JSON) before it reaches json.loads(),
# which has no depth cap and would otherwise raise an uncaught RecursionError
# (a RuntimeError, not ValueError) on a client-supplied query parameter.
_MAX_CURSOR_LENGTH = 512

# Maps the URL-safe base64 alphabet back to the standard one so validate=True
# can reject any stray character outright rather than silently stripping it —
# the cursor is untrusted, client-controlled input.
_URLSAFE_TO_STANDARD = str.maketrans("-_", "+/")


@dataclass(frozen=True)
class CursorPosition:
    """The `(created_at, id)` pair a keyset page resumes from."""

    created_at: datetime
    id: UUID


def _encode_json_payload(payload: Any) -> str:
    # Also used by tests constructing a deliberately malformed cursor.
    compact_json = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(compact_json.encode("utf-8")).decode("ascii")


def encode_cursor(position: CursorPosition) -> str:
    """Serialise a CursorPosition to an opaque, URL-safe string."""
    payload = {
        "created_at": position.created_at.isoformat(),
        "id": str(position.id),
    }
    return _encode_json_payload(payload)


def decode_cursor(value: str) -> CursorPosition:
    """Parse a cursor produced by `encode_cursor`.

    Raises ValueError("Invalid pagination cursor") for every malformed input.
    """
    if len(value) > _MAX_CURSOR_LENGTH:
        raise ValueError(_INVALID_CURSOR_MESSAGE)

    try:
        # urlsafe_b64decode has no validate= of its own.
        translated = value.translate(_URLSAFE_TO_STANDARD)
        decoded_bytes = base64.b64decode(translated.encode("ascii"), validate=True)
        payload = json.loads(decoded_bytes)

        if not isinstance(payload, dict) or set(payload) != {"created_at", "id"}:
            raise ValueError(_INVALID_CURSOR_MESSAGE)

        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None:
            # A naive timestamp would silently compare as UTC downstream.
            raise ValueError(_INVALID_CURSOR_MESSAGE)

        row_id = UUID(payload["id"])
    except (
        binascii.Error,
        ValueError,
        TypeError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        AttributeError,
        # RecursionError is a RuntimeError, not ValueError, so needs its own
        # entry as defense-in-depth if _MAX_CURSOR_LENGTH is ever bypassed.
        RecursionError,
    ) as exc:
        raise ValueError(_INVALID_CURSOR_MESSAGE) from exc

    return CursorPosition(created_at=created_at, id=row_id)
