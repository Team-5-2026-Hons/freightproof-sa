"""Schemas for PP manifests (FP-281): the manifest reference on trip reads, and the
preview and create-from-manifest request/response shapes."""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, model_validator

# "CGY Logistics · JNB 69" — client, then the manifest as PP staff would say it.
_DISPLAY_SEPARATOR = " · "


class PPManifestRef(BaseModel):
    """A trip's PP manifest key plus a display label (spec §6). Null on trips without one."""

    issuer_account: str
    origin_hub: str
    number: int
    display: str

    @classmethod
    def of(
        cls, *, issuer_account: str, origin_hub: str, number: int, client_name: str | None,
    ) -> "PPManifestRef":
        label = f"{origin_hub} {number}"
        return cls(
            issuer_account=issuer_account, origin_hub=origin_hub, number=number,
            display=f"{client_name}{_DISPLAY_SEPARATOR}{label}" if client_name else label,
        )

    @classmethod
    def from_columns(
        cls,
        *,
        issuer_account: Optional[str],
        origin_hub: Optional[str],
        number: Optional[int],
        client_name: Optional[str],
    ) -> "PPManifestRef | None":
        """From a Trip row's three key columns; None when the trip has no manifest."""
        if issuer_account is None or origin_hub is None or number is None:
            return None
        return cls.of(
            issuer_account=issuer_account, origin_hub=origin_hub, number=number,
            client_name=client_name,
        )


class PPManifestWarningCode(str, Enum):
    MANIFEST_ALREADY_ON_TRIP = "MANIFEST_ALREADY_ON_TRIP"
    CLIENT_NOT_LINKED = "CLIENT_NOT_LINKED"
    WAYBILL_CLIENT_MISMATCH = "WAYBILL_CLIENT_MISMATCH"
    WAYBILL_ON_OTHER_TRIP = "WAYBILL_ON_OTHER_TRIP"
    NO_WAYBILLS = "NO_WAYBILLS"
    ORIGIN_HUB_UNLINKED = "ORIGIN_HUB_UNLINKED"
    DESTINATION_HUB_UNLINKED = "DESTINATION_HUB_UNLINKED"
    NO_PLANNED_TIMES = "NO_PLANNED_TIMES"
    MANIFEST_NOT_CLOSED = "MANIFEST_NOT_CLOSED"


# Spec §10.1: these refuse creation; the rest prompt for a value or inform.
BLOCKING_WARNING_CODES: frozenset[PPManifestWarningCode] = frozenset({
    PPManifestWarningCode.MANIFEST_ALREADY_ON_TRIP,
    PPManifestWarningCode.CLIENT_NOT_LINKED,
    PPManifestWarningCode.WAYBILL_CLIENT_MISMATCH,
    PPManifestWarningCode.WAYBILL_ON_OTHER_TRIP,
    PPManifestWarningCode.NO_WAYBILLS,
})


class PPManifestErrorCode(str, Enum):
    """Codes on create's 409/422 bodies that are not preview warnings."""

    MANIFEST_CHANGED = "MANIFEST_CHANGED"
    PRECINCT_REQUIRED = "PRECINCT_REQUIRED"
    PRECINCT_NOT_AVAILABLE = "PRECINCT_NOT_AVAILABLE"   # not the client's, or not visible to you
    SAME_PRECINCT = "SAME_PRECINCT"
    NO_PLANNED_DEPARTURE = "NO_PLANNED_DEPARTURE"
    SCHEDULE_INVALID = "SCHEDULE_INVALID"


class PPManifestWarning(BaseModel):
    code: PPManifestWarningCode
    message: str
    blocking: bool
    trip_id: Optional[UUID] = None          # the trip holding the manifest or waybills
    trip_reference: Optional[str] = None
    waybills: list[str] = []                # WAYBILL_CLIENT_MISMATCH, WAYBILL_ON_OTHER_TRIP


class PPManifestHub(BaseModel):
    hub_code: str
    precinct_id: Optional[UUID] = None      # null when the hub is linked to no precinct
    precinct_name: Optional[str] = None


class PPManifestNoteRead(BaseModel):
    noted_at: datetime
    operator: str
    text: str


class PPManifestWaybillLine(BaseModel):
    """Dispatcher-only line detail, as on the manifest panel today."""

    waybill: str
    destination_town: str
    parcel_count: int
    weight_kg: Optional[float] = None


class PPManifestTotalsRead(BaseModel):
    waybills: int
    parcels: int
    weight_kg: float


class PPManifestPreviewResponse(BaseModel):
    """GET /trips/pp-manifest-preview. Read-only. snapshot_sha256 is sent back with the
    create request, so what the dispatcher reviewed is what gets locked (spec §10.2)."""

    pp_manifest: PPManifestRef
    snapshot_sha256: str
    client_organization_id: Optional[UUID] = None
    client_name: str                        # the linked org's name, else PP's issuer name
    origin: PPManifestHub
    destination: PPManifestHub
    planned_departure_at: Optional[datetime] = None
    expected_arrival_at: Optional[datetime] = None
    is_closed: bool
    client_reference: Optional[str] = None
    notes: list[PPManifestNoteRead]
    totals: PPManifestTotalsRead
    waybills: list[PPManifestWaybillLine]
    warnings: list[PPManifestWarning]
    can_create: bool


_SHA256_HEX = r"^[0-9a-f]{64}$"


class TripFromPPManifestRequest(BaseModel):
    """POST /trips/from-pp-manifest (spec §10.2).

    Cargo is never accepted from the client — the server pulls it. Precincts are used
    only for a hub the manifest could not link; planned times override the manifest's.
    Times must carry a zone (AwareDatetime): the lock normalises to UTC, and a zone-less
    value could not be normalised honestly."""

    manifest_number: int = Field(..., gt=0)
    expected_snapshot_sha256: str = Field(..., pattern=_SHA256_HEX)
    driver_id: UUID
    horse_id: UUID
    trailer_ids: list[UUID] = Field(default_factory=list)
    planned_departure_at: Optional[AwareDatetime] = None
    planned_arrival_at: Optional[AwareDatetime] = None
    origin_precinct_id: Optional[UUID] = None
    destination_precinct_id: Optional[UUID] = None

    @model_validator(mode="after")
    def no_duplicate_trailers(self) -> "TripFromPPManifestRequest":
        if len(self.trailer_ids) != len(set(self.trailer_ids)):
            raise ValueError("trailer_ids must not contain duplicates")
        return self
