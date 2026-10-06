"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.limits import PP_LOOKUP
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.integrations.parcel_perfect import PPWaybillNotFoundError
from app.orchestration import consignment_service, pp_lookup_service
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


@router.get("/capabilities", response_model=PPCapabilities, summary="PP client capabilities")
async def get_capabilities_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPCapabilities:
    return pp_lookup_service.get_capabilities()


# Reaches out to Parcel Perfect, whose quota is a partner resource we neither own nor pay
# for: an unbounded loop here abuses someone else's system as much as ours. Budgeted like
# the manifest preview (PP_LOOKUP).
@router.get("/waybills/{waybill_number}", response_model=PPWaybillSummary,
            summary="Validate a PP waybill reference",
            dependencies=[Depends(rate_limit(PP_LOOKUP))])
async def get_waybill_endpoint(
    waybill_number: str,
    current_user: UserRead = Depends(get_current_dispatcher),
    db: AsyncSession = Depends(get_db),
) -> PPWaybillSummary:
    try:
        summary = await pp_lookup_service.get_waybill_summary(waybill_number)
    except PPWaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        # Real client raises ValueError (PP errorcode != 0) or httpx errors on outage.
        logger.warning("PP lookup failed for waybill %s: %s", waybill_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc

    # Advisory only (see get_assigned_trip_reference docstring): a failure here must not
    # turn a successful PP lookup into a 500 for the dispatcher, so it degrades to None
    # rather than propagating, mirroring the PP-outage handling above.
    try:
        summary.already_assigned_to_trip = await consignment_service.get_assigned_trip_reference(
            db, waybill_number,
        )
    except SQLAlchemyError as exc:
        logger.warning("Already-assigned check failed for waybill %s: %s", waybill_number, exc)
        # get_db() commits on a normal return; a failed SELECT leaves the session's
        # transaction unusable until rolled back, so this must happen before returning.
        await db.rollback()
        summary.already_assigned_to_trip = None

    return summary
