"""The receiver identity cross-check: does the vendor's extracted identity agree with what the
receiver typed? Pure string comparison: no database, no vendor call.
"""

import unicodedata
from typing import Optional


def _strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _normalise_name(value: str) -> str:
    """Casefold, strip accents, collapse whitespace, drop punctuation.

    Punctuation goes because "NKOSI" vs "Nkosi," is not a mismatch, and treating it
    as one would manufacture fraud signals out of typing habits.
    """
    cleaned = "".join(
        char if char.isalnum() or char.isspace() else " "
        for char in _strip_diacritics(value)
    )
    return " ".join(cleaned.casefold().split())


def _normalise_id_number(value: str) -> str:
    """Keep alphanumerics only, so formatting/separator differences don't fail the compare."""
    return "".join(char for char in value if char.isalnum()).casefold()


def _contains_token_run(haystack: list[str], needle: list[str]) -> bool:
    """Whether `needle` appears in `haystack` as a contiguous run of whole tokens."""
    width = len(needle)
    return any(haystack[i:i + width] == needle for i in range(len(haystack) - width + 1))


def identity_matches(
    *,
    typed_name: str,
    typed_id_number: str,
    extracted_surname: Optional[str],
    extracted_id_number: Optional[str],
) -> Optional[bool]:
    """Whether the vendor's extracted identity agrees with what the receiver typed.

    Returns None — not False — when there's nothing to compare: "could not check"
    and "checked and disagreed" are different facts, same split as SEAL_UNVERIFIED
    vs SEAL_MISMATCH.

    Only the SURNAME is compared, for presence among the typed name's tokens.
    Given-name ordering/initials vary too much to carry a fraud signal; an absent
    surname does. Never blocks anything — a False result is evidence, not a gate.

    The surname is matched as a contiguous run of whole tokens, not a single token:
    "van der Merwe" is three tokens, and "Smith-Jones" normalises to two because
    punctuation becomes a space. Whole tokens (not a substring) so "Merwe" does not
    match "Merwenstein"; contiguous and ordered so "van Merwe" does not match
    "van der Merwe".
    """
    if extracted_surname is None and extracted_id_number is None:
        return None

    if extracted_id_number is not None:
        if _normalise_id_number(typed_id_number) != _normalise_id_number(extracted_id_number):
            return False

    if extracted_surname is not None:
        surname_tokens = _normalise_name(extracted_surname).split()
        if not surname_tokens or not _contains_token_run(
            _normalise_name(typed_name).split(), surname_tokens,
        ):
            return False

    return True
