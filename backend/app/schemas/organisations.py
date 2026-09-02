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

# Precinct.address is a Text column, so the database imposes no ceiling of its own and
# there is no body-size middleware in front of it. Every other field on this model is
# bounded; without this one an address is the only unbounded input on the write path,
# and it is copied verbatim into the anchored PrecinctEvent.changed_fields payload.
# 500 is generous for a street address and small enough that it cannot bloat the ledger.
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
    caller's JWT and never accepted from the client, which is what stops a dispatcher
    creating a precinct under another organization's id (SEC-PRECINCT-1). Same rule and
    same reason as VehicleCreateBody in schemas/vehicles.py.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr
    address: Optional[PrecinctAddressStr] = None
    latitude: LatitudeFloat
    longitude: LongitudeFloat
    geofence_radius_metres: RadiusMetresInt = _RADIUS_DEFAULT_METRES
    is_shared: bool = False


class PrecinctUpdateBody(BaseModel):
    """Fields an admin dispatcher may change via PATCH /precincts/{id}.

    Every field is omissible — only supplied fields are applied, via
    model_dump(exclude_unset=True). principal_organization_id is absent here too:
    ownership is not transferable, so a precinct cannot be moved into or out of another
    org's control.

    OMISSIBLE IS NOT THE SAME AS NULLABLE, and the annotations below say which is which.
    `Optional[X]` means "this column accepts null, and an explicit null clears it";
    a bare `X = Field(default=None)` means "you may omit this, but you may not null it".

    Only `address` is nullable on the Precinct model. Declaring the rest `Optional`
    would let an explicit `{"latitude": null}` pass validation, reach
    setattr(precinct, "latitude", None), and raise NotNullViolation at flush — a 500 on
    a well-formed request. Encoding it in the annotation rather than in a validator is
    deliberate: it keeps the 422 attached to the offending field, and it keeps the
    generated OpenAPI schema honest (latitude is `number`, address is `string | null`),
    so a client generated from the schema cannot be told that null is acceptable.

    The default is never read — exclude_unset drops any field the caller omitted — so
    `Field(default=None)` is a placeholder for "absent", not a value. It is spelled with
    Field() rather than a bare `= None` so the annotation stays honest to a type checker.

    test_patch_schema_nullability_matches_the_precinct_model pins this against the
    SQLAlchemy model, so a column that changes nullability cannot leave this stale.
    """

    model_config = ConfigDict(from_attributes=True)

    name: PrecinctNameStr = Field(default=None)  # type: ignore[assignment]  # exclude_unset drops this default; never read
    # The one genuinely nullable column: an explicit null is a deliberate clear.
    address: Optional[PrecinctAddressStr] = None
    latitude: LatitudeFloat = Field(default=None)  # type: ignore[assignment]  # exclude_unset drops this default; never read
    longitude: LongitudeFloat = Field(default=None)  # type: ignore[assignment]  # exclude_unset drops this default; never read
    geofence_radius_metres: RadiusMetresInt = Field(default=None)  # type: ignore[assignment]  # exclude_unset drops this default; never read
    is_shared: bool = Field(default=None)  # type: ignore[assignment]  # exclude_unset drops this default; never read


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
