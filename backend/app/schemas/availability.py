"""Pydantic v2 schemas for crew availability: who is busy, on which trip, until when (FP-139/FP-142).

One shape serves both the 409 a clashing trip creation gets and the read the trip wizard uses to
grey out busy options, so the screen and the server always describe a clash the same way.
"""

import enum
from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, model_validator

from app.db.models.enums import TripStatus


class CrewResourceType(str, enum.Enum):
    """The three things a trip occupies. Ordered as the wizard asks for them."""

    DRIVER = "driver"
    HORSE = "horse"
    TRAILER = "trailer"


class BusyEntry(BaseModel):
    """One driver, horse or trailer, and the trip that has it in the asked-about window."""

    resource_type: CrewResourceType
    resource_id: UUID
    # Driver full name or vehicle registration: what the dispatcher recognises.
    label: str
    trip_id: UUID
    trip_reference: str
    trip_status: TripStatus
    busy_from: datetime
    # None = busy until the trip is closed or cancelled: a live trip past its planned end,
    # or an old trip that never had one. No one can promise a time for those.
    busy_until: datetime | None
    # The trip's planned end, kept even when busy_until is None, so the screen can say "was due …".
    planned_until: datetime | None


class CrewAvailabilityQuery(BaseModel):
    """GET /trips/availability query: a half-open window [start, end). Zone required: trip times
    are stored aware, and comparing them with a zone-less value would be a guess."""

    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def end_after_start(self) -> "CrewAvailabilityQuery":
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class CrewAvailabilityResponse(BaseModel):
    start: datetime
    end: datetime
    busy: list[BusyEntry]
