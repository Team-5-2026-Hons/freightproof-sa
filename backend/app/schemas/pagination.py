"""Generic response envelope for cursor-paginated list endpoints."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class CursorPage(BaseModel, Generic[T]):
    """One page of results plus the opaque cursor to fetch the next one."""

    items: list[T]
    next_cursor: str | None  # None means this is the last page
    total_items: int = Field(ge=0)
