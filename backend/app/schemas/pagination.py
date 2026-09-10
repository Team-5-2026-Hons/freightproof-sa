"""Generic response envelope for cursor-paginated list endpoints.

Wraps whatever item schema an endpoint already serves — `CursorPage[TripRead]`,
`CursorPage[ExceptionRead]`, and so on — so every paginated endpoint returns the
same three fields instead of each inventing its own next-page convention.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class CursorPage(BaseModel, Generic[T]):
    """One page of results plus the opaque cursor to fetch the next one."""

    items: list[T]
    # None means this is the last page. Callers pass this straight back as the
    # next request's cursor query param — see app/core/pagination.py for the
    # encoding, which this schema deliberately says nothing about.
    next_cursor: str | None
    # Total rows matching the query, independent of page size — lets a client
    # render "showing 20 of 143" without a second count query of its own.
    total_items: int = Field(ge=0)
