"""Shared constraints and cleaning for user-supplied text.

Two problems this module exists to solve, both of which showed up across the schemas as
"a plain `str` with nothing attached":

**Unbounded length.** A `str` field with no ceiling is accepted by Pydantic, handed to
SQLAlchemy, and rejected by Postgres — asyncpg raises StringDataRightTruncation, which
surfaces as a 500. A validation failure reported as a server error is a bug in its own
right (it tells the caller we broke, not that they did), and on the `Text` columns there
is no ceiling at all: whatever was pasted is simply stored. schemas/vehicles.py already
solved this for its own fields; this module is that solution made reusable so every
other schema stops re-deriving it.

**Characters that make stored text render as something else.** FreightProof records
evidence, and evidence is only worth what its integrity is worth. A bidirectional
override character inside an exception description makes the text a dispatcher reads in
the browser differ from the bytes on record — the same trick as a Trojan Source attack,
pointed at an audit trail instead of a compiler. Control characters likewise corrupt log
lines and CSV exports. Both are stripped on the way in, so the stored value and the
rendered value cannot disagree.

Cleaning is deliberately narrow: it removes characters that have no legitimate place in a
human-entered field and leaves everything else exactly as typed. It is NOT an
HTML/SQL sanitiser and must never be treated as one — SQL safety comes from SQLAlchemy's
parameter binding, and HTML safety from React escaping by default. Stripping characters
to "make input safe" for those layers would be a false comfort and would silently corrupt
legitimate content (an address containing `&`, a note containing `<`).
"""

import re
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

# ── Length ceilings ──────────────────────────────────────────────────────────
# Each mirrors the width of the column the value lands in. Where the column is TEXT
# (no width of its own) the ceiling is a judgement about what a person plausibly types,
# because "unbounded" on a field one authenticated user can write to at will is a storage
# cost anyone with an account can impose.

NAME_MAX_LENGTH = 255           # people.full_name, organisations.name — String(255)
EMAIL_MAX_LENGTH = 255          # users.email — String(255)
PHONE_MAX_LENGTH = 20           # drivers.phone_number — String(20)
LICENSE_MAX_LENGTH = 50         # drivers.license_number — String(50)
ORDER_NUMBER_MAX_LENGTH = 100   # trips.order_number — String(100)
REFERENCE_MAX_LENGTH = 100      # pulsit_trip_reference_id, parcel_perfect_reference
CHECKPOINT_TYPE_MAX_LENGTH = 50  # checkpoints.checkpoint_type — String(50)
SHORT_NOTE_MAX_LENGTH = 255     # trip_stops.notes — String(255)
ADDRESS_MAX_LENGTH = 1000       # organisations.address — TEXT

# Free-form narrative on a TEXT column: exception descriptions, resolver notes,
# dispatcher override notes. Long enough that nobody hits it writing an honest account of
# what happened at a depot gate, short enough that it cannot be used as free storage.
FREE_TEXT_MAX_LENGTH = 2000

# ── Character cleaning ───────────────────────────────────────────────────────

# Stripped from every cleaned field. Written as escapes rather than literal characters
# on purpose: several of these are invisible, and a class containing invisible characters
# is one nobody can review or safely edit.
#
#   \x00-\x08 \x0b \x0c \x0e-\x1f \x7f   C0 controls and DEL, keeping \t \n \r
#   \x80-\x9f                            C1 controls
#   ​-‏                        zero-width space/joiners, LTR/RTL marks
#   ‪-‮                        bidi embedding and OVERRIDE — the ones that
#                                        make rendered text disagree with stored text
#   ⁦-⁩                        bidi isolates (same class of trick)
#   ﻿                               zero-width no-break space / stray BOM
_DISALLOWED_CHARS = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f"
    "​-‏‪-‮⁦-⁩﻿]"
)


def clean_text(value: str) -> str:
    """Strip disallowed characters and surrounding whitespace.

    Runs AFTER the length constraint, so a caller cannot slip past a ceiling by padding
    with characters that this then removes.

    Note what is preserved: tab, newline and carriage return survive, because a multi-line
    exception description is legitimate. Interior whitespace is untouched — collapsing it
    would edit the evidence, and this is a record of what someone wrote.
    """
    return _DISALLOWED_CHARS.sub("", value).strip()


# ── Reusable field types ─────────────────────────────────────────────────────
# Compose as `Optional[NameStr]`, `FreeText`, and so on. Each pairs a ceiling with the
# cleaner; min_length where a blank value would be meaningless rather than merely absent.

NameStr = Annotated[
    str, StringConstraints(min_length=1, max_length=NAME_MAX_LENGTH), AfterValidator(clean_text)
]
EmailStr = Annotated[
    str, StringConstraints(min_length=1, max_length=EMAIL_MAX_LENGTH), AfterValidator(clean_text)
]
PhoneStr = Annotated[
    str, StringConstraints(min_length=1, max_length=PHONE_MAX_LENGTH), AfterValidator(clean_text)
]
LicenseStr = Annotated[
    str, StringConstraints(min_length=1, max_length=LICENSE_MAX_LENGTH), AfterValidator(clean_text)
]
OrderNumberStr = Annotated[
    str, StringConstraints(min_length=1, max_length=ORDER_NUMBER_MAX_LENGTH), AfterValidator(clean_text)
]
ReferenceStr = Annotated[
    str, StringConstraints(min_length=1, max_length=REFERENCE_MAX_LENGTH), AfterValidator(clean_text)
]
CheckpointTypeStr = Annotated[
    str, StringConstraints(min_length=1, max_length=CHECKPOINT_TYPE_MAX_LENGTH), AfterValidator(clean_text)
]
ShortNoteStr = Annotated[
    str, StringConstraints(max_length=SHORT_NOTE_MAX_LENGTH), AfterValidator(clean_text)
]
AddressStr = Annotated[
    str, StringConstraints(max_length=ADDRESS_MAX_LENGTH), AfterValidator(clean_text)
]

# Required narrative — a description or note that must actually say something. min_length
# is applied before cleaning, so a value of only control characters would pass the
# constraint and clean to "". RequiredFreeText's own validator closes that.
FreeText = Annotated[
    str, StringConstraints(max_length=FREE_TEXT_MAX_LENGTH), AfterValidator(clean_text)
]


def _require_content(value: str) -> str:
    """Reject a value that is empty once cleaned.

    Guards the gap min_length cannot: `"\\u200b\\u200b"` is two characters to Pydantic's
    length check and nothing at all to a reader. On fields that exist to record WHY
    something happened (a cancellation, an override, a raised exception), an empty
    explanation that passed validation is worse than a rejected one.
    """
    if not value:
        raise ValueError("must not be blank")
    return value


RequiredFreeText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=FREE_TEXT_MAX_LENGTH),
    AfterValidator(clean_text),
    AfterValidator(_require_content),
]
