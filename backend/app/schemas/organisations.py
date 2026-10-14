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
    pp_account_number: Optional[str] = Field(None, max_length=6)  # PP accnum, String(6)


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
    # Numeric(10,7) in the DB; float is used here (not Decimal) so it serialises as a JSON
    # number the frontend can call .toFixed() on.
    latitude: float
    longitude: float
    geofence_radius_metres: int = 200
    is_shared: bool = False


# Mirrors Numeric(10, 7) DB columns, so Pydantic 422s instead of Postgres raising
# NumericValueOutOfRange as a 500.
_LATITUDE_MIN, _LATITUDE_MAX = -90.0, 90.0
_LONGITUDE_MIN, _LONGITUDE_MAX = -180.0, 180.0

# Floor matches GPS_TOLERANCE_METRES (50) — narrower makes the FP-68 corroboration check
# meaningless. Ceiling catches a unit slip (km entered as m).
_RADIUS_MIN_METRES = 50
_RADIUS_MAX_METRES = 5_000
_RADIUS_DEFAULT_METRES = 200

_NAME_MAX_LENGTH = 255  # mirrors String(255) on Precinct.name

# Precinct.address is a Text column with no DB ceiling; this bounds it so the value
# copied into PrecinctEvent.changed_fields can't bloat the anchored ledger.
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
    is_shared: bool = False


class PrecinctUpdateBody(BaseModel):
    """Fields an admin dispatcher may change via PATCH /precincts/{id}; only supplied
    fields apply (model_dump(exclude_unset=True)). principal_organization_id is absent:
    ownership is not transferable.

    Omissible is not the same as nullable: `Optional[X]` means the column accepts an
    explicit null; a bare `X = Field(default=None)` means omissible but not nullable.
    Only `address` is genuinely nullable on the Precinct model — the rest would otherwise
    raise NotNullViolation at flush as a 500 instead of a 422.
    test_patch_schema_nullability_matches_the_precinct_model pins this against the model.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr = Field(default=None)  # type: ignore[assignment]
    address: Optional[PrecinctAddressStr] = None  # genuinely nullable: explicit null clears it
    latitude: LatitudeFloat = Field(default=None)  # type: ignore[assignment]
    longitude: LongitudeFloat = Field(default=None)  # type: ignore[assignment]
    geofence_radius_metres: RadiusMetresInt = Field(default=None)  # type: ignore[assignment]
    is_shared: bool = Field(default=None)  # type: ignore[assignment]


class PrecinctRead(PrecinctBase):
    id: UUID
    created_at: datetime


# Imported here, not at module top, to keep the schema dependency graph acyclic.
from app.schemas.blockchain import BlockchainReceiptRead  # noqa: E402
from app.schemas.events import PrecinctEventRead  # noqa: E402


class PrecinctDetailResponse(PrecinctRead):
    """Extended shape returned by GET /precincts/{id}, with full change history and receipts."""

    events: list[PrecinctEventRead] = []
    receipts: list[BlockchainReceiptRead] = []
