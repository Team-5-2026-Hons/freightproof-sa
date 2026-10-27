"""Response models for a trip's planned road route (driver PWA map + ETA)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

RouteProvider = Literal["openrouteservice"]
RouteProfile = Literal["driving-hgv"]
ROUTE_PROVIDER: RouteProvider = "openrouteservice"
ROUTE_PROFILE: RouteProfile = "driving-hgv"


class TripRouteLegResponse(BaseModel):
    """The road between two consecutive stops, identified by their TripStop.sequence
    so the PWA can match it to the in_transit phase's stop_sequence."""

    from_stop_sequence: int
    to_stop_sequence: int
    distance_metres: float = Field(..., ge=0)
    duration_seconds: float = Field(..., ge=0)
    coordinates: list[tuple[float, float]]


class TripRouteResponse(BaseModel):
    """A display aid, not evidence: never hashed, anchored or stored in Postgres."""

    trip_id: UUID
    provider: RouteProvider = ROUTE_PROVIDER
    profile: RouteProfile = ROUTE_PROFILE
    distance_metres: float = Field(..., ge=0)
    duration_seconds: float = Field(..., ge=0)
    legs: list[TripRouteLegResponse]
    computed_at: datetime
