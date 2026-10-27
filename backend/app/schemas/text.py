"""Shared length ceilings and character cleaning for user-supplied text: bounds fields
that would otherwise overflow Postgres as a 500, and strips invisible/bidi-override
characters (Trojan-Source-style) so stored and rendered text can't disagree. Not an
HTML/SQL sanitiser — that safety comes from SQLAlchemy binding and React escaping.
"""

import re
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

NAME_MAX_LENGTH = 255
EMAIL_MAX_LENGTH = 255
PHONE_MAX_LENGTH = 20
LICENSE_MAX_LENGTH = 50
REFERENCE_MAX_LENGTH = 100
CHECKPOINT_TYPE_MAX_LENGTH = 50
SHORT_NOTE_MAX_LENGTH = 255
ADDRESS_MAX_LENGTH = 1000

FREE_TEXT_MAX_LENGTH = 2000

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
