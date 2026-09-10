"""Opaque cursor primitives for keyset (cursor-based) pagination.

A cursor identifies a row's position in a `created_at, id` ordering — the tie-break
on `id` exists because `created_at` alone is not unique (bulk inserts, clock
resolution), and without it two rows sharing a timestamp could be skipped or
repeated across a page boundary. The cursor carries only these two fields: no
filter state and no PII, so it stays safe to log and safe to hand back to any
caller regardless of what they are allowed to see.

Callers must never construct or introspect a cursor's contents directly — treat
`encode_cursor`/`decode_cursor` as the only door in and out, since the wire format
is free to change without notice.
"""

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

# One message for every failure mode (bad base64, bad JSON, wrong shape, naive
# timestamp, invalid UUID). Distinguishing them in the response would tell a client
# probing the cursor parameter which layer of decoding it broke through — that is
# an attack surface a pagination cursor has no business exposing.
_INVALID_CURSOR_MESSAGE = "Invalid pagination cursor"

# A real cursor is ~80-110 bytes (compact JSON of an ISO timestamp + a UUID,
# base64'd). This is generous headroom above that, not a tuned budget — its job
# is to reject grossly-oversized input, e.g. deeply-nested JSON, BEFORE it ever
# reaches json.loads(). json.loads() recurses per nesting level with no depth
# cap of its own, so a ~26KB value of nothing but "[" repeated blows the
# interpreter's recursion limit and raises RecursionError — a RuntimeError
# subclass, not a ValueError — which would otherwise escape this function
# entirely and surface as an uncaught 500 from a client-supplied query
# parameter. Checked first, before any decode work, so the payload is never
# even handed to json.loads().
_MAX_CURSOR_LENGTH = 512

# Maps the URL-safe base64 alphabet's substitutions back to the standard alphabet.
# validate=True (only on base64.b64decode, not urlsafe_b64decode) rejects any
# character outside the base64 alphabet outright, rather than silently discarding
# it before decoding — without it, a client-supplied cursor with junk spliced into
# the middle would decode to whatever survived the silent strip instead of
# failing, which matters because the cursor is untrusted, client-controlled input.
_URLSAFE_TO_STANDARD = str.maketrans("-_", "+/")


@dataclass(frozen=True)
class CursorPosition:
    """The `(created_at, id)` pair a keyset page resumes from."""

    created_at: datetime
    id: UUID


def _encode_json_payload(payload: Any) -> str:
    # Shared by encode_cursor and by tests constructing a deliberately malformed
    # cursor (valid encoding, wrong shape) — the wire mechanics are identical either
    # way, only the payload's shape differs.
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

    Raises ValueError("Invalid pagination cursor") for every malformed input —
    see the module docstring for why the message never varies with the cause.
    """
    if len(value) > _MAX_CURSOR_LENGTH:
        # First check, before any decode work — see _MAX_CURSOR_LENGTH's comment.
        raise ValueError(_INVALID_CURSOR_MESSAGE)

    try:
        # urlsafe_b64decode has no validate= of its own, so translate -_ back to
        # +/ and call b64decode directly with validate=True (see the constant's
        # docstring above for why that matters here).
        translated = value.translate(_URLSAFE_TO_STANDARD)
        decoded_bytes = base64.b64decode(translated.encode("ascii"), validate=True)
        payload = json.loads(decoded_bytes)

        # Reject anything but exactly {"created_at": ..., "id": ...}: a wider or
        # narrower shape is not a cursor this module ever produced.
        if not isinstance(payload, dict) or set(payload) != {"created_at", "id"}:
            raise ValueError(_INVALID_CURSOR_MESSAGE)

        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None:
            # A naive timestamp would silently compare as UTC downstream and
            # manufacture a wrong page boundary rather than fail loudly.
            raise ValueError(_INVALID_CURSOR_MESSAGE)

        row_id = UUID(payload["id"])
    except (
        # binascii.Error, UnicodeDecodeError, and json.JSONDecodeError are all
        # already ValueError subclasses in CPython — listed anyway so a reader
        # can see every failure mode this catches without checking each type's
        # base class.
        binascii.Error,
        ValueError,
        TypeError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        AttributeError,
        # Defense-in-depth: _MAX_CURSOR_LENGTH is the real guard against deeply
        # nested JSON exhausting json.loads()'s recursion, but this stays in
        # place in case that cap is ever bypassed or changed. RecursionError is
        # a RuntimeError subclass, not a ValueError, so it needs its own entry.
        RecursionError,
    ) as exc:
        raise ValueError(_INVALID_CURSOR_MESSAGE) from exc

    return CursorPosition(created_at=created_at, id=row_id)
