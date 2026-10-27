"""Pydantic v2 schemas for Organization and Precinct."""

import math
from datetime import datetime
from uuid import UUID
from typing import Annotated, Any, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.core import polygon as geo_polygon
from app.db.models.enums import OrganizationType


class OrganizationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    org_type: OrganizationType
    contact_email: Optional[str] = None
    pp_account_number: Optional[str] = Field(None, max_length=6)


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    org_type: Optional[OrganizationType] = None
    contact_email: Optional[str] = None


class OrganizationRead(OrganizationBase):
    id: UUID
    created_at: datetime


class PrecinctBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    principal_organization_id: UUID
    address: Optional[str] = None
    latitude: float
    longitude: float
    geofence_radius_metres: int = 200
    geofence_polygon: Optional[list[tuple[float, float]]] = None
    is_shared: bool = False


_LATITUDE_MIN, _LATITUDE_MAX = -90.0, 90.0
_LONGITUDE_MIN, _LONGITUDE_MAX = -180.0, 180.0

_RADIUS_MIN_METRES = 50
_RADIUS_MAX_METRES = 5_000
_RADIUS_DEFAULT_METRES = 200

_NAME_MAX_LENGTH = 255

_ADDRESS_MAX_LENGTH = 500

PrecinctNameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=_NAME_MAX_LENGTH)
]
PrecinctAddressStr = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=_ADDRESS_MAX_LENGTH)
]
LatitudeFloat = Annotated[float, Field(ge=_LATITUDE_MIN, le=_LATITUDE_MAX)]
LongitudeFloat = Annotated[float, Field(ge=_LONGITUDE_MIN, le=_LONGITUDE_MAX)]
RadiusMetresInt = Annotated[int, Field(ge=_RADIUS_MIN_METRES, le=_RADIUS_MAX_METRES)]

_POLYGON_MAX_VERTICES = 500
_POLYGON_MIN_AREA_M2 = 400.0
_POLYGON_MAX_AREA_M2 = math.pi * _RADIUS_MAX_METRES**2
PIN_MAX_OUTSIDE_POLYGON_METRES = 100.0
_COORDINATE_DECIMALS = 7


def _normalise_polygon(value: list[tuple[float, float]]) -> list[list[float]]:
    """Validate an outline and return it as rounded [lat, lng] lists.

    Lists, not tuples: JSONB hands lists back, and the precinct diff compares the stored
    value with the new one — a tuple would read as "changed" even when it isn't.
    """
    corners = [[round(lat, _COORDINATE_DECIMALS), round(lng, _COORDINATE_DECIMALS)] for lat, lng in value]
    if len(corners) > geo_polygon.MIN_POLYGON_VERTICES and corners[0] == corners[-1]:
        corners = corners[:-1]
    ring = [(c[0], c[1]) for c in corners]
    if len(ring) < geo_polygon.MIN_POLYGON_VERTICES:
        raise ValueError(f"An outline needs at least {geo_polygon.MIN_POLYGON_VERTICES} distinct corners.")
    if not geo_polygon.is_simple(ring):
        raise ValueError("The outline crosses itself or repeats a corner.")
    area = geo_polygon.area_square_metres(ring)
    if area < _POLYGON_MIN_AREA_M2:
        raise ValueError(f"The outline is too small ({area:.0f} m²); the minimum is {_POLYGON_MIN_AREA_M2:.0f} m².")
    if area > _POLYGON_MAX_AREA_M2:
        raise ValueError(
            f"The outline is too large ({area / 1e6:.1f} km²); it may not exceed the largest "
            f"allowed circle ({_POLYGON_MAX_AREA_M2 / 1e6:.1f} km²)."
        )
    return corners


GeofencePolygon = Annotated[
    list[tuple[LatitudeFloat, LongitudeFloat]],
    Field(min_length=geo_polygon.MIN_POLYGON_VERTICES, max_length=_POLYGON_MAX_VERTICES + 1),
    AfterValidator(_normalise_polygon),
]


def check_pin_fits_polygon(latitude: float, longitude: float, polygon: list[Any]) -> None:
    """Raise ValueError when the pin is neither inside the outline nor near its edge.

    Shared by PrecinctCreateBody and update_precinct (a PATCH may move only one of the two).
    """
    ring = [(float(c[0]), float(c[1])) for c in polygon]
    point = (float(latitude), float(longitude))
    if geo_polygon.contains(ring, point):
        return
    distance = geo_polygon.distance_to_boundary_metres(ring, point)
    if distance > PIN_MAX_OUTSIDE_POLYGON_METRES:
        raise ValueError(
            f"The pin is {distance:.0f} m outside the outline; it must be inside it or within "
            f"{PIN_MAX_OUTSIDE_POLYGON_METRES:.0f} m of its edge."
        )


class PrecinctCreateBody(BaseModel):
    """Fields an admin dispatcher submits when mapping a new precinct.

    principal_organization_id is deliberately absent — ownership is injected from the
    caller's JWT, not accepted from the client (SEC-PRECINCT-1).
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr
    address: Optional[PrecinctAddressStr] = None
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    geofence_radius_metres: RadiusMetresInt = _RADIUS_DEFAULT_METRES
    geofence_polygon: Optional[GeofencePolygon] = None
    is_shared: bool = False

    @model_validator(mode="after")
    def _pin_fits_polygon(self) -> "PrecinctCreateBody":
        if self.geofence_polygon is not None:
            check_pin_fits_polygon(self.latitude, self.longitude, self.geofence_polygon)
        return self


class PrecinctUpdateBody(BaseModel):
    """Fields an admin dispatcher may change via PATCH /precincts/{id}; only supplied
    fields apply (model_dump(exclude_unset=True)). principal_organization_id is absent:
    ownership is not transferable.

    Omissible is not the same as nullable: `Optional[X]` means the column accepts an
    explicit null; a bare `X = Field(default=None)` means omissible but not nullable.
    Only `address` and `geofence_polygon` are genuinely nullable on the Precinct model — the rest would otherwise
    raise NotNullViolation at flush as a 500 instead of a 422.
    test_patch_schema_nullability_matches_the_precinct_model pins this against the model.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr = Field(default=None)  # type: ignore[assignment]
    address: Optional[PrecinctAddressStr] = None
    latitude: LatitudeFloat = Field(default=None)  # type: ignore[assignment]
    longitude: LongitudeFloat = Field(default=None)  # type: ignore[assignment]
    geofence_radius_metres: RadiusMetresInt = Field(default=None)  # type: ignore[assignment]
    geofence_polygon: Optional[GeofencePolygon] = None
    is_shared: bool = Field(default=None)  # type: ignore[assignment]


class PrecinctRead(PrecinctBase):
    id: UUID
    created_at: datetime


from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import PrecinctEventRead  # noqa: E402


class PrecinctDetailResponse(PrecinctRead):
    """Extended shape returned by GET /precincts/{id}, with full change history and receipts."""

    events: list[PrecinctEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
