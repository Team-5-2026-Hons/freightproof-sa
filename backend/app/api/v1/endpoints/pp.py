"""Dispatcher-facing Parcel Perfect lookup endpoints (wizard-time validation)."""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import WaybillNotFoundError
from app.core.limits import PP_LOOKUP
from app.core.rate_limit import rate_limit
from app.db.cleanup import rollback_after_error
from app.db.session import get_db
from app.orchestration.consignments import sync as consignment_service
from app.orchestration.consignments import waybill_lookup as pp_lookup_service
from app.schemas.people import UserRead
from app.schemas.pp import PPCapabilities, PPWaybillSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pp", tags=["parcel-perfect"])

_PP_UNREACHABLE_DETAIL = (
    "Parcel Perfect is unreachable — the reference will be verified at trip creation."
)


@router.get("/capabilities", response_model=PPCapabilities, summary="PP client capabilities")
async def get_capabilities_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PPCapabilities:
    return pp_lookup_service.get_capabilities()


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
    except WaybillNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("PP lookup failed for waybill %s: %s", waybill_number, exc)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=_PP_UNREACHABLE_DETAIL,
        ) from exc

    try:
        summary.already_assigned_to_trip = await consignment_service.get_assigned_trip_reference(
            db, waybill_number,
        )
    except SQLAlchemyError as exc:
        logger.warning("Already-assigned check failed for waybill %s: %s", waybill_number, exc)
        if not await rollback_after_error(db):
            raise
        summary.already_assigned_to_trip = None

    return summary
