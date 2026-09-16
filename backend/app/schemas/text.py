"""Shared length ceilings and character cleaning for user-supplied text: bounds fields
that would otherwise overflow Postgres as a 500, and strips invisible/bidi-override
characters (Trojan-Source-style) so stored and rendered text can't disagree. Not an
HTML/SQL sanitiser — that safety comes from SQLAlchemy binding and React escaping.
"""

import re
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

# Each mirrors the width of its column; TEXT columns get a judgement-call ceiling instead.

NAME_MAX_LENGTH = 255           # people.full_name, organisations.name — String(255)
EMAIL_MAX_LENGTH = 255          # users.email — String(255)
PHONE_MAX_LENGTH = 20           # drivers.phone_number — String(20)
LICENSE_MAX_LENGTH = 50         # drivers.license_number — String(50)
ORDER_NUMBER_MAX_LENGTH = 100   # trips.order_number — String(100)
REFERENCE_MAX_LENGTH = 100      # pulsit_trip_reference_id, parcel_perfect_reference
CHECKPOINT_TYPE_MAX_LENGTH = 50  # checkpoints.checkpoint_type — String(50)
SHORT_NOTE_MAX_LENGTH = 255     # trip_stops.notes — String(255)
ADDRESS_MAX_LENGTH = 1000       # organisations.address — TEXT

# Free-form narrative (exception descriptions, resolver/override notes): long enough for
# an honest account, short enough to not be free storage.
FREE_TEXT_MAX_LENGTH = 2000

# Written as escapes, not literal characters, because several are invisible: C0/C1
# controls and DEL (keeping \t \n \r), zero-width space/joiners, bidi embedding/override/
# isolate marks, and a stray BOM — the ones that make rendered text disagree with stored text.
_DISALLOWED_CHARS = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f"
    "​-‏‪-‮⁦-⁩﻿]"
)


def clean_text(value: str) -> str:
    """Strip disallowed characters and surrounding whitespace.

    Runs AFTER the length constraint, so padding can't be used to slip past a ceiling.
    Tab/newline/CR and interior whitespace are preserved — this is a record of what
    someone wrote.
    """
    return _DISALLOWED_CHARS.sub("", value).strip()


# Compose as `Optional[NameStr]`, `FreeText`, etc. Each pairs a ceiling with the cleaner.

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

# min_length is applied before cleaning, so a value of only control characters would pass
# and clean to "" — RequiredFreeText's own validator closes that gap.
FreeText = Annotated[
    str, StringConstraints(max_length=FREE_TEXT_MAX_LENGTH), AfterValidator(clean_text)
]


def _require_content(value: str) -> str:
    """Reject a value that is empty once cleaned.

    Guards the gap min_length cannot: `"\\u200b\\u200b"` passes the length check but
    reads as nothing.
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
