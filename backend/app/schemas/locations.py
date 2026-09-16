"""Pydantic schemas for the driver's per-trip location trail (POST /trips/{id}/locations).

POPIA: these carry personal location data. They exist to move a fix from the driver's
phone into Postgres and back out to an authorised reader — no canonical-payload builder
or anchoring path may ever consume them.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Endpoint takes a batch (offline queue flush); bounded so one driver can't DoS the table.
MAX_PINGS_PER_REQUEST = 200

MAX_CONTEXT_LENGTH = 80  # matches TripLocationPing.context's String(80)


class LocationPingCreate(BaseModel):
    """One position fix as the device recorded it."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: Optional[float] = Field(default=None, ge=0)  # metres; negative is a client bug
    context: str = Field(min_length=1, max_length=MAX_CONTEXT_LENGTH)
    recorded_at: datetime  # device capture time, not receipt time — offline pings replay late


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
