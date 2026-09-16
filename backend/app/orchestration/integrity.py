"""Extracts unique-violation details from a Postgres IntegrityError.

asyncpg wraps the driver exception, so `constraint_name` only survives at
`exc.orig.__cause__` — reading `exc.orig` alone silently returns None.
"""

from typing import Optional

from sqlalchemy.exc import IntegrityError

# Postgres SQLSTATE for unique_violation.
UNIQUE_VIOLATION = "23505"


def is_unique_violation(exc: IntegrityError) -> bool:
    """True when this IntegrityError is a uniqueness conflict, not e.g. a foreign-key or not-null failure."""
    orig = getattr(exc, "orig", None)
    pgcode = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return pgcode == UNIQUE_VIOLATION


def violated_constraint(exc: IntegrityError) -> Optional[str]:
    """Name of the violated constraint, or None if the driver didn't report one.

    Callers should re-raise rather than guess when None.
    """
    orig = getattr(exc, "orig", None)
    return getattr(orig, "constraint_name", None) or getattr(
        getattr(orig, "__cause__", None), "constraint_name", None
    )
