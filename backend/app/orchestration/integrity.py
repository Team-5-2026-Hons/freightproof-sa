"""Reading a Postgres integrity error without depending on driver wrapping details.

Every service that turns a unique violation into a domain error needs the same two
facts: was this a unique violation, and which constraint did it hit. Both are more
awkward to get than they look, so they are answered once here.

SQLAlchemy's asyncpg adapter re-wraps the driver exception. It copies `sqlstate` onto
`exc.orig`, but `constraint_name` survives only on the original asyncpg
UniqueViolationError underneath, at `exc.orig.__cause__`. Reading only `exc.orig` —
the obvious thing to write — silently yields None for the constraint name, and a
service that keys on it then falls through to a 500 where it meant to return a 409.

Layering: orchestration → sqlalchemy only. No app imports, so anything may use it.
"""

from typing import Optional

from sqlalchemy.exc import IntegrityError

# Postgres unique_violation.
UNIQUE_VIOLATION = "23505"


def is_unique_violation(exc: IntegrityError) -> bool:
    """True when this IntegrityError is a uniqueness conflict rather than, say, a
    foreign-key or not-null failure — which must never be reported as a duplicate."""
    orig = getattr(exc, "orig", None)
    pgcode = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return pgcode == UNIQUE_VIOLATION


def violated_constraint(exc: IntegrityError) -> Optional[str]:
    """Name of the constraint or unique index the violation hit, if the driver said.

    Returns None when it did not. Callers that map a constraint to a user-facing field
    must treat None as "cannot tell" and re-raise rather than guess: naming the wrong
    field sends someone to correct something that was never wrong.
    """
    orig = getattr(exc, "orig", None)
    return getattr(orig, "constraint_name", None) or getattr(
        getattr(orig, "__cause__", None), "constraint_name", None
    )
