"""Pydantic schemas for the driver's per-trip location trail (POST /trips/{id}/locations).

POPIA: these carry personal location data. They exist to move a fix from the driver's
phone into Postgres and back out to an authorised reader — no canonical-payload builder
or anchoring path may ever consume them.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# One flush of the PWA's offline queue can carry a backlog of fixes, so the endpoint
# takes a batch. Bounded because an unbounded list is a free denial-of-service against
# a table that one authenticated driver can write to at will; a day of interaction-rate
# pings is comfortably under this, and a larger backlog simply flushes as two requests.
MAX_PINGS_PER_REQUEST = 200

# Free-form label describing what the driver was doing (a route, or an action name).
# Length-capped to match TripLocationPing.context's String(80).
MAX_CONTEXT_LENGTH = 80


class LocationPingCreate(BaseModel):
    """One position fix as the device recorded it."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    # Metres of horizontal uncertainty. Optional (not every platform reports it) but
    # never negative — a negative accuracy is a client bug, not a wide fix.
    accuracy_m: Optional[float] = Field(default=None, ge=0)
    context: str = Field(min_length=1, max_length=MAX_CONTEXT_LENGTH)
    # Device capture time, not receipt time: a replayed offline ping is hours older than
    # its request, and ordering the trail by arrival would draw the route out of sequence.
    recorded_at: datetime


class LocationPingBatch(BaseModel):
    """The request body — one or more fixes for a single trip."""

    pings: list[LocationPingCreate] = Field(min_length=1, max_length=MAX_PINGS_PER_REQUEST)


class LocationPingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trip_id: UUID
    driver_id: UUID
    lat: float
    lng: float
    accuracy_m: Optional[float] = None
    context: str
    recorded_at: datetime
    created_at: datetime


class LocationPingBatchResult(BaseModel):
    """What the batch write actually stored, so the PWA can clear exactly those entries."""

    recorded: int
