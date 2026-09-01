"""Pydantic v2 schemas for Organization and Precinct."""

from datetime import datetime
from uuid import UUID
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.db.models.enums import OrganizationType


class OrganizationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    org_type: OrganizationType
    contact_email: Optional[str] = None
    # PP client account number — resolves inbound consignments' accnum to this org.
    # max_length mirrors the String(6) DB column (PP account numbers are 6 chars).
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
    # Numeric(10,7) in the DB; float is exact here since a GPS coordinate is at
    # most 10 significant digits and float64 carries ~15.65 — see schema fix
    # notes. Decimal would serialise to a JSON string, which the frontend
    # (a `number` type) can't call .toFixed() on.
    latitude: float
    longitude: float
    geofence_radius_metres: int = 200
    is_shared: bool = False


# Bounds mirrored from the DB column and the domain, so Pydantic answers with a 422
# before Postgres does. latitude/longitude are Numeric(10, 7) — precision 10, scale 7,
# so three digits before the point. Anything >= 1000 raises a raw asyncpg
# NumericValueOutOfRange that surfaces as a 500; the real world is tighter anyway.
_LATITUDE_MIN, _LATITUDE_MAX = -90.0, 90.0
_LONGITUDE_MIN, _LONGITUDE_MAX = -180.0, 180.0

# The floor is not arbitrary: GPS_TOLERANCE_METRES is 50, so a geofence narrower than
# the agreement tolerance itself makes the FP-68 corroboration check meaningless —
# every trip through it would fail. The ceiling catches a unit slip (km entered as m)
# and a stray digit; 5 km is well beyond any real facility.
_RADIUS_MIN_METRES = 50
_RADIUS_MAX_METRES = 5_000
_RADIUS_DEFAULT_METRES = 200

_NAME_MAX_LENGTH = 255  # mirrors String(255) on Precinct.name

PrecinctNameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=_NAME_MAX_LENGTH)
]
LatitudeFloat = Annotated[float, Field(ge=_LATITUDE_MIN, le=_LATITUDE_MAX)]
LongitudeFloat = Annotated[float, Field(ge=_LONGITUDE_MIN, le=_LONGITUDE_MAX)]
RadiusMetresInt = Annotated[int, Field(ge=_RADIUS_MIN_METRES, le=_RADIUS_MAX_METRES)]


class PrecinctCreateBody(BaseModel):
    """Fields an admin dispatcher submits when mapping a new precinct.

    principal_organization_id is deliberately absent — ownership is injected from the
    caller's JWT and never accepted from the client, which is what stops a dispatcher
    creating a precinct under another organization's id (SEC-PRECINCT-1). Same rule and
    same reason as VehicleCreateBody in schemas/vehicles.py.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr
    address: Optional[str] = None
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    geofence_radius_metres: RadiusMetresInt = _RADIUS_DEFAULT_METRES
    is_shared: bool = False


class PrecinctUpdateBody(BaseModel):
    """Fields an admin dispatcher may change via PATCH /precincts/{id}.

    All optional — only supplied fields are applied, via model_dump(exclude_unset=True).
    principal_organization_id is absent here too: ownership is not transferable, so a
    precinct cannot be moved into or out of another org's control.
    """

    model_config = ConfigDict(from_attributes=True)

    name: Optional[PrecinctNameStr] = None
    address: Optional[str] = None
    latitude: Optional[LatitudeFloat] = None
    longitude: Optional[LongitudeFloat] = None
    geofence_radius_metres: Optional[RadiusMetresInt] = None
    is_shared: Optional[bool] = None


class PrecinctRead(PrecinctBase):
    id: UUID
    created_at: datetime


# Imported here rather than at the top of the module to keep the schema dependency
# graph acyclic — same reason and same placement as in schemas/vehicles.py.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import PrecinctEventRead  # noqa: E402


class PrecinctDetailResponse(PrecinctRead):
    """Extended shape returned by GET /precincts/{id}.

    Carries the full change history and its linked receipts, which is what makes a
    precinct's coordinates auditable rather than merely current.
    """

    events: list[PrecinctEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
