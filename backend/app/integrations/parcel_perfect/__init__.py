"""Compatibility facade: the Parcel Perfect integration now lives in app.integrations.parcel_perfect.*.

Every public name that used to be defined in the parcel_perfect module is re-exported so existing
imports keep resolving. New code imports from the submodule that owns the name; tests must patch
the module that looks a name up, never this one (check B8).
"""

# Order matters: the three fixture modules each add their waybills to MOCK_WAYBILLS when first
# imported, and the mock lists waybills in that dict's order. unassigned_fixtures must come
# before manifest_fixtures to keep the order the single-file module produced.
from app.integrations.parcel_perfect.errors import (
    PPManifestNotFoundError,
    PPUnsupportedError,
    PPWaybillNotFoundError,
)
from app.integrations.parcel_perfect.models import (
    PPContents,
    PPManifestHeader,
    PPManifestNote,
    PPManifestResponse,
    PPTrack,
    PPWaybillDetails,
    PPWaybillRef,
    PPWaybillResponse,
)
from app.integrations.parcel_perfect.timestamps import (
    PP_DATETIME_FORMAT,
    parse_pp_datetime,
    pp_timezone,
)
from app.integrations.parcel_perfect.waybill_fixtures import (
    DEMO_HUB_CODES,
    MOCK_WAYBILL_RESPONSE,
    MOCK_WAYBILLS,
    SEEDED_WAYBILLS,
    UNASSIGNED_MANIFEST_NUMBER,
)
from app.integrations.parcel_perfect.unassigned_fixtures import UNASSIGNED_WAYBILLS
from app.integrations.parcel_perfect.manifest_fixtures import (
    MANIFEST_DEMO_WAYBILLS,
    MANIFEST_HAPPY_PATH,
    MANIFEST_NO_WAYBILLS,
    MANIFEST_OPEN_NO_TIMES,
    MOCK_MANIFEST_HEADERS,
)
from app.integrations.parcel_perfect.client import ParcelPerfectClient
from app.integrations.parcel_perfect.port import ParcelPerfectPort
from app.integrations.parcel_perfect.mock import MockParcelPerfectClient
from app.integrations.parcel_perfect.factory import get_pp_client

__all__ = [
    "DEMO_HUB_CODES",
    "MANIFEST_DEMO_WAYBILLS",
    "MANIFEST_HAPPY_PATH",
    "MANIFEST_NO_WAYBILLS",
    "MANIFEST_OPEN_NO_TIMES",
    "MOCK_MANIFEST_HEADERS",
    "MOCK_WAYBILLS",
    "MOCK_WAYBILL_RESPONSE",
    "MockParcelPerfectClient",
    "PPContents",
    "PPManifestHeader",
    "PPManifestNotFoundError",
    "PPManifestNote",
    "PPManifestResponse",
    "PPTrack",
    "PPUnsupportedError",
    "PPWaybillDetails",
    "PPWaybillNotFoundError",
    "PPWaybillRef",
    "PPWaybillResponse",
    "PP_DATETIME_FORMAT",
    "ParcelPerfectClient",
    "ParcelPerfectPort",
    "SEEDED_WAYBILLS",
    "UNASSIGNED_MANIFEST_NUMBER",
    "UNASSIGNED_WAYBILLS",
    "get_pp_client",
    "parse_pp_datetime",
    "pp_timezone",
]
