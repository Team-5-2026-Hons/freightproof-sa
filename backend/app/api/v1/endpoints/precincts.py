"""FastAPI router for precinct endpoints.

GET   /precincts       — precincts owned by the caller's organization plus any
                         precinct marked is_shared (origin/destination gates).
GET   /precincts/{id}  — one precinct the caller may see, with its change history.
POST  /precincts       — map a new precinct. Admin dispatcher only.
PATCH /precincts/{id}  — correct an existing one. Admin dispatcher only.

Reads and writes are scoped differently on purpose: a dispatcher can SEE a shared
precinct owned by another organization, but may only WRITE to one their own org owns.
A write against anything else returns 404 rather than 403 — see precinct_service.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher, require_admin_dispatcher
from app.core.exceptions import (
    DuplicateResourceError,
    HederaServiceError,
    HederaTimeoutError,
    ResourceNotFoundError,
)
from app.core.limits import PRECINCT_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import DispatcherRole
from app.db.session import get_db
from app.orchestration.precinct_service import (
    create_precinct, get_precinct_detail, list_precincts, update_precinct,
)
from app.schemas.organisations import (
    PrecinctCreateBody, PrecinctDetailResponse, PrecinctRead, PrecinctUpdateBody,
)
from app.schemas.people import UserRead

router = APIRouter(prefix="/precincts", tags=["precincts"])


@router.get(
    "",
    response_model=list[PrecinctRead],
    summary="List the caller's organization's physical depots and warehouses, plus shared precincts",
)
async def list_precincts_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> list[PrecinctRead]:
    return await list_precincts(db=db, organization_id=current_user.organization_id)


@router.post(
    "",
    response_model=PrecinctRead,
    status_code=status.HTTP_201_CREATED,
    summary="Map a new precinct against the caller's organization",
    dependencies=[Depends(rate_limit(PRECINCT_MUTATION))],
)
async def create_precinct_endpoint(
    body: PrecinctCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> PrecinctRead:
    try:
        return await create_precinct(
            db=db,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except HederaServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.patch(
    "/{precinct_id}",
    response_model=PrecinctRead,
    summary="Correct a precinct owned by the caller's organization",
    dependencies=[Depends(rate_limit(PRECINCT_MUTATION))],
)
async def update_precinct_endpoint(
    precinct_id: UUID,
    body: PrecinctUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(require_admin_dispatcher),
) -> PrecinctRead:
    try:
        return await update_precinct(
            db=db,
            precinct_id=precinct_id,
            organization_id=current_user.organization_id,
            data=body,
            current_user_id=current_user.id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except DuplicateResourceError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except HederaServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get(
    "/{precinct_id}",
    response_model=PrecinctDetailResponse,
    summary="One precinct with its change history and blockchain receipts",
)
async def get_precinct_detail_endpoint(
    precinct_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> PrecinctDetailResponse:
    try:
        detail = await get_precinct_detail(
            db=db,
            precinct_id=precinct_id,
            organization_id=current_user.organization_id,
        )
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    # Receipts are withheld from non-admins, matching get_vehicle_detail_endpoint.
    # A precinct visible only via is_shared is never the caller's own, so its receipts
    # are withheld from that caller too — subject_visibility would refuse them anyway,
    # and showing a hash the viewer cannot verify is worse than showing nothing.
    is_owner = detail.principal_organization_id == current_user.organization_id
    if current_user.role != DispatcherRole.ADMIN_DISPATCHER or not is_owner:
        detail = detail.model_copy(update={"receipts": []})
    return detail
