"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.auth.dependencies import get_current_dispatcher
from app.integrations.parcel_perfect import PPUnsupportedError, PPWaybillNotFoundError
from app.orchestration import pp_lookup_service
from app.schemas.people import UserRead
from app.schemas.pp import PPCapabilities, PPWaybillSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pp", tags=["parcel-perfect"])

# Wizard-time lookups are advisory: a PP outage here must not read as "waybill
# invalid". Trip creation itself re-validates fail-closed (H0), so 502 + retry
# guidance is the honest answer. Mirrors the Hedera outage mapping in trips.py.
_PP_UNREACHABLE_DETAIL = (
    "Parcel Perfect is unreachable — the reference will be verified at trip creation."
)

# str(PPUnsupportedError) carries an internal engineering note (PP feature ask);
# clients get this stable message instead.
_MANIFEST_UNSUPPORTED_DETAIL = (
    "Manifest lookup is not available on the live Parcel Perfect API."
)


@router.get("/capabilities", response_model=PPCapabilities, summary="PP client capabilities")
async def get_capabilities_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPCapabilities:
    return pp_lookup_service.get_capabilities()


@router.get("/waybills/{waybill_number}", response_model=PPWaybillSummary,
            summary="Validate a PP waybill reference")
async def get_waybill_endpoint(
    waybill_number: str,
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPWaybillSummary:
    try:
        return await pp_lookup_service.get_waybill_summary(waybill_number)
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        # Real client raises ValueError (PP errorcode != 0) or httpx errors on outage.
        logger.warning("PP lookup failed for waybill %s: %s", waybill_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc


@router.get("/manifests/{manifest_number}", response_model=list[PPWaybillSummary],
            summary="List waybills on a PP manifest (mock-only capability)")
async def get_manifest_endpoint(
    manifest_number: int,
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PPWaybillSummary]:
    try:
        return await pp_lookup_service.get_manifest_summaries(manifest_number)
    except PPUnsupportedError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=_MANIFEST_UNSUPPORTED_DETAIL,
        ) from exc
    except (ValueError, httpx.HTTPError) as exc:
        # Real client raises ValueError (PP errorcode != 0) or httpx errors on outage.
        logger.warning("PP lookup failed for manifest %s: %s", manifest_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc
