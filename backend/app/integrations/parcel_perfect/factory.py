"""Chooses the real or the mock Parcel Perfect client from settings.PP_USE_MOCK."""

from app.core.config import settings
from app.integrations.parcel_perfect.client import ParcelPerfectClient
from app.integrations.parcel_perfect.mock import MockParcelPerfectClient
from app.integrations.parcel_perfect.port import ParcelPerfectPort


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_pp_client() -> ParcelPerfectPort:
    """Return the appropriate PP client based on settings.PP_USE_MOCK.

    Callers should depend on this factory rather than instantiating clients
    directly so that mock/real behaviour is controlled centrally via config.
    """
    if settings.PP_USE_MOCK:
        return MockParcelPerfectClient()
    return ParcelPerfectClient()
