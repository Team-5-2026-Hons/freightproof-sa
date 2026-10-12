"""Dispatcher parcel lookup and ledger-derived history (FP-149)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import ResourceNotFoundError
from app.db.session import get_db
from app.orchestration.parcel_trace.service import lookup_parcels, trace_parcel
from app.schemas.parcel_trace import ParcelLookupQuery, ParcelLookupResponse, ParcelTraceQuery, ParcelTraceResponse
from app.schemas.people import UserRead

router = APIRouter(prefix="/parcels", tags=["parcels"])


@router.get("/lookup", response_model=ParcelLookupResponse)
async def lookup_parcels_endpoint(
    query: Annotated[ParcelLookupQuery, Query()],
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ParcelLookupResponse:
    return await lookup_parcels(db, organization_id=current_user.organization_id, query=query)


@router.get("/trace", response_model=ParcelTraceResponse)
async def trace_parcel_endpoint(
    query: Annotated[ParcelTraceQuery, Query()],
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ParcelTraceResponse:
    try:
        return await trace_parcel(db, organization_id=current_user.organization_id, query=query)
    except ResourceNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcel trace not found") from None
