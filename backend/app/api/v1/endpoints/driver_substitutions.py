"""FP-83 driver substitution routes (contract: docs/contracts/driver-substitution-v1.md).

Three routers, because the audiences and prefixes differ:

- `dispatcher_router`  /trips/{trip_id}/driver-substitutions  arrange, read, cancel, replace,
  complete and correct; any same-organisation dispatcher, with admin-only identity attestation
  enforced in the service.
- `late_evidence_router` /trips/{trip_id}/late-evidence  the dispatcher's review of retained
  late evidence.
- `driver_router`  /trips/me  the driver's assignments, notices, collection context, captures,
  participation history and late evidence. Registered in main.py BEFORE the trips router, so
  `/trips/me/driver-substitutions` is never parsed as `/trips/{trip_id}`.

Endpoints only validate, call the service and translate its domain errors (`_domain_errors`);
every decision lives in orchestration/substitutions.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.custody_errors import custody_http_exception, substitution_http_exception
from app.auth.dependencies import get_current_dispatcher, get_current_driver
from app.core.exceptions import (
    CustodyAccessError, EvidenceAttributionError, ResourceNotFoundError, SubstitutionError,
    SubstitutionInvalidError, TripStateError,
)
from app.core.limits import ARTIFACT_UPLOAD, EVIDENCE_WRITE, FLEET_MUTATION
from app.core.rate_limit import rate_limit
from app.db.models.enums import ArtifactType
from app.db.session import get_db
from app.orchestration.evidence.artifacts import MAX_FILE_SIZE_BYTES
from app.orchestration.substitutions import reads
from app.orchestration.substitutions.artifacts import (
    HandoverUploadClaim, ValidatedArtifactUpload, create_late_evidence_artifact, create_substitution_artifact,
)
from app.orchestration.substitutions.late_evidence import acknowledge_late_evidence, retain_late_evidence
from app.orchestration.substitutions.notices import list_notices, mark_notice_read
from app.orchestration.substitutions.service import (
    cancel_substitution, complete_attested_substitution, confirm_substitution,
    correct_completed_substitution,
)
from app.orchestration.substitutions.client_operations import arrange_immediate_or_replay as arrange_substitution, replace_immediate_or_replay as replace_substitution
from app.schemas.driver_substitutions import (
    AcknowledgeLateEvidenceRequest, ArrangeSubstitutionRequest, ArrangeImmediateSubstitutionRequest, ReplaceImmediateSubstitutionRequest, ConfirmSubstitutionObservationRequest, CancelSubstitutionRequest,
    CompleteSubstitutionRequest, ConfirmSubstitutionRequest, CorrectSubstitutionRequest,
    DriverParticipationHistoryRead, DriverSubstitutionContextRead, LateEvidenceDetailRead, LateEvidenceRead,
    LateEvidenceRequest, ReplaceSubstitutionRequest, SubstitutionCorrectionRead, SubstitutionErrorResponse,
    SubstitutionNoticeRead, SubstitutionRequestRead, SubstitutionRole,
    CompletedSubstitutionDetail,
)
from app.schemas.evidence import EvidenceArtifactRead
from app.schemas.people import DriverRead, UserRead

_TAGS: list[str | Enum] = ["driver-substitutions"]
# Documented on every mutation: the coded conflict body the contract defines.
_CONFLICTS: dict[int | str, dict[str, object]] = {
    409: {"model": SubstitutionErrorResponse}, 503: {"model": SubstitutionErrorResponse},
}


@contextmanager
def _domain_errors() -> Iterator[None]:
    """The one mapping from service outcomes to HTTP, per the contract's status matrix."""
    try:
        yield
    except ResourceNotFoundError as exc:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (SubstitutionInvalidError, EvidenceAttributionError, ValueError) as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except SubstitutionError as exc:
        raise substitution_http_exception(exc) from exc
    except CustodyAccessError as exc:
        raise custody_http_exception(exc) from exc
    except TripStateError as exc:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=str(exc)) from exc


async def _read_upload(file: UploadFile) -> bytes:
    """The ordinary upload route's size rules: refuse on the declared size before reading, then
    again on the real size, because the header is client-supplied."""
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )
    body = await file.read()
    if len(body) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )
    return body


@dataclass(kw_only=True)
class _UploadForm:
    """The ordinary artifact multipart fields plus the idempotency key, as one dependency."""

    client_request_id: Annotated[UUID, Form()]
    artifact_type: Annotated[ArtifactType, Form()]
    captured_at: Annotated[datetime, Form()]
    file: Annotated[UploadFile, File()]
    captured_lat: Annotated[Decimal | None, Form()] = None
    captured_lng: Annotated[Decimal | None, Form()] = None

    async def validated(self) -> ValidatedArtifactUpload:
        return ValidatedArtifactUpload(
            client_request_id=self.client_request_id, file_bytes=await _read_upload(self.file),
            mime_type=self.file.content_type or "application/octet-stream", artifact_type=self.artifact_type,
            captured_at=self.captured_at, captured_lat=self.captured_lat, captured_lng=self.captured_lng,
        )


@dataclass(kw_only=True)
class _HandoverUploadForm(_UploadForm):
    """Plus the side the uploader claims; validated against their account and the request."""

    role: Annotated[SubstitutionRole, Form()]


# ── dispatcher ───────────────────────────────────────────────────────────────

dispatcher_router = APIRouter(prefix="/trips/{trip_id}/driver-substitutions", tags=_TAGS)


@dispatcher_router.post(
    "", response_model=SubstitutionRequestRead, status_code=http_status.HTTP_201_CREATED, responses=_CONFLICTS,
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def arrange_substitution_endpoint(
    trip_id: UUID, payload: ArrangeSubstitutionRequest | ArrangeImmediateSubstitutionRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionRequestRead:
    with _domain_errors():
        return await arrange_substitution(db, trip_id=trip_id, actor=current_user, payload=payload)


@dispatcher_router.get("", response_model=list[SubstitutionRequestRead])
async def list_substitutions_endpoint(
    trip_id: UUID, db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> list[SubstitutionRequestRead]:
    with _domain_errors():
        return await reads.list_trip_requests(db, trip_id=trip_id, actor=current_user)


@dispatcher_router.get("/{request_id}", response_model=SubstitutionRequestRead)
async def get_substitution_endpoint(
    trip_id: UUID, request_id: UUID,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionRequestRead:
    with _domain_errors():
        return await reads.get_trip_request(db, trip_id=trip_id, request_id=request_id, actor=current_user)


@dispatcher_router.get("/completed/{substitution_id}", response_model=CompletedSubstitutionDetail)
async def completed_substitution_endpoint(
    trip_id: UUID, substitution_id: UUID,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> CompletedSubstitutionDetail:
    with _domain_errors():
        return await reads.get_completed_substitution(db, trip_id=trip_id, substitution_id=substitution_id, actor=current_user)


@dispatcher_router.post(
    "/{request_id}/cancel", response_model=SubstitutionRequestRead, responses=_CONFLICTS,
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def cancel_substitution_endpoint(
    trip_id: UUID, request_id: UUID, payload: CancelSubstitutionRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionRequestRead:
    with _domain_errors():
        return await cancel_substitution(db, trip_id=trip_id, request_id=request_id, actor=current_user, payload=payload)


@dispatcher_router.post(
    "/{request_id}/replace", response_model=SubstitutionRequestRead, responses=_CONFLICTS,
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def replace_substitution_endpoint(
    trip_id: UUID, request_id: UUID, payload: ReplaceSubstitutionRequest | ReplaceImmediateSubstitutionRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionRequestRead:
    with _domain_errors():
        return await replace_substitution(db, trip_id=trip_id, request_id=request_id, actor=current_user, payload=payload)


@dispatcher_router.post(
    "/{request_id}/complete", response_model=SubstitutionRequestRead,
    responses={**_CONFLICTS, 403: {"model": SubstitutionErrorResponse}},
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def complete_substitution_endpoint(
    trip_id: UUID, request_id: UUID, payload: CompleteSubstitutionRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionRequestRead:
    with _domain_errors():
        return await complete_attested_substitution(
            db, trip_id=trip_id, request_id=request_id, actor=current_user, payload=payload,
        )


@dispatcher_router.post(
    "/completed/{substitution_id}/corrections", response_model=SubstitutionCorrectionRead,
    status_code=http_status.HTTP_201_CREATED, responses=_CONFLICTS, dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def correct_substitution_endpoint(
    trip_id: UUID, substitution_id: UUID, payload: CorrectSubstitutionRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> SubstitutionCorrectionRead:
    with _domain_errors():
        return await correct_completed_substitution(
            db, trip_id=trip_id, substitution_id=substitution_id, actor=current_user, payload=payload,
        )


# ── dispatcher review of late evidence ───────────────────────────────────────

late_evidence_router = APIRouter(prefix="/trips/{trip_id}/late-evidence", tags=_TAGS)


@late_evidence_router.get("", response_model=list[LateEvidenceDetailRead])
async def list_late_evidence_endpoint(
    trip_id: UUID, db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> list[LateEvidenceDetailRead]:
    with _domain_errors():
        return await reads.list_late_evidence(db, trip_id=trip_id, actor=current_user)


@late_evidence_router.post(
    "/{evidence_id}/acknowledge", response_model=LateEvidenceRead, responses=_CONFLICTS,
    dependencies=[Depends(rate_limit(FLEET_MUTATION))],
)
async def acknowledge_late_evidence_endpoint(
    trip_id: UUID, evidence_id: UUID, payload: AcknowledgeLateEvidenceRequest,
    db: AsyncSession = Depends(get_db), current_user: UserRead = Depends(get_current_dispatcher),
) -> LateEvidenceRead:
    with _domain_errors():
        return await acknowledge_late_evidence(
            db, trip_id=trip_id, evidence_id=evidence_id, actor=current_user, payload=payload,
        )


# ── driver ───────────────────────────────────────────────────────────────────

driver_router = APIRouter(prefix="/trips/me", tags=_TAGS)


@driver_router.get("/driver-substitutions", response_model=list[SubstitutionRequestRead])
async def my_substitutions_endpoint(
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> list[SubstitutionRequestRead]:
    """Pending handovers naming this driver; independent of /trips/me/active."""
    return await reads.get_driver_substitution_assignments(db, driver_id=current_driver.id)


@driver_router.get("/substitution-notices", response_model=list[SubstitutionNoticeRead])
async def my_notices_endpoint(
    unread_only: Annotated[bool, Query()] = True,
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> list[SubstitutionNoticeRead]:
    return await list_notices(db, driver_id=current_driver.id, unread_only=unread_only)


@driver_router.post("/substitution-notices/{notice_id}/read", response_model=SubstitutionNoticeRead)
async def read_notice_endpoint(
    notice_id: UUID, db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> SubstitutionNoticeRead:
    """Marks the notice read. Never a confirmation and never a custody change."""
    with _domain_errors():
        return await mark_notice_read(db, notice_id=notice_id, driver_id=current_driver.id)


@driver_router.get("/{trip_id}/driver-substitutions/{request_id}", response_model=DriverSubstitutionContextRead)
async def my_substitution_context_endpoint(
    trip_id: UUID, request_id: UUID,
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> DriverSubstitutionContextRead:
    with _domain_errors():
        return await reads.get_driver_context(db, trip_id=trip_id, request_id=request_id, driver_id=current_driver.id)


@driver_router.post(
    "/{trip_id}/driver-substitutions/{request_id}/artifacts", response_model=EvidenceArtifactRead,
    status_code=http_status.HTTP_201_CREATED, responses=_CONFLICTS, dependencies=[Depends(rate_limit(ARTIFACT_UPLOAD))],
)
async def upload_handover_artifact_endpoint(
    trip_id: UUID, request_id: UUID, form: Annotated[_HandoverUploadForm, Depends()],
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> EvidenceArtifactRead:
    """A photo for the caller's own side of a pending handover (no phase_event_id)."""
    upload = await form.validated()
    with _domain_errors():
        return await create_substitution_artifact(
            db, trip_id=trip_id, driver=current_driver, claim=HandoverUploadClaim(request_id=request_id, role=form.role),
            upload=upload,
        )


@driver_router.post(
    "/{trip_id}/driver-substitutions/{request_id}/confirmations", response_model=SubstitutionRequestRead,
    responses=_CONFLICTS, dependencies=[Depends(rate_limit(EVIDENCE_WRITE))],
)
async def confirm_substitution_endpoint(
    trip_id: UUID, request_id: UUID, payload: ConfirmSubstitutionRequest | ConfirmSubstitutionObservationRequest,
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> SubstitutionRequestRead:
    """200 whenever the capture was saved, including a pending request with completion_blocked_by."""
    with _domain_errors():
        return await confirm_substitution(
            db, trip_id=trip_id, request_id=request_id, actor=current_driver, payload=payload,
        )


@driver_router.get("/{trip_id}/participation", response_model=DriverParticipationHistoryRead)
async def my_participation_endpoint(
    trip_id: UUID, db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> DriverParticipationHistoryRead:
    with _domain_errors():
        return await reads.get_driver_participation_history(db, trip_id=trip_id, driver_id=current_driver.id)


@driver_router.post(
    "/{trip_id}/late-evidence/artifacts", response_model=EvidenceArtifactRead,
    status_code=http_status.HTTP_201_CREATED, responses=_CONFLICTS, dependencies=[Depends(rate_limit(ARTIFACT_UPLOAD))],
)
async def upload_late_artifact_endpoint(
    trip_id: UUID, custody_sequence: Annotated[int, Form(ge=0)], form: Annotated[_UploadForm, Depends()],
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> EvidenceArtifactRead:
    upload = await form.validated()
    with _domain_errors():
        return await create_late_evidence_artifact(
            db, trip_id=trip_id, driver=current_driver, custody_sequence=custody_sequence, upload=upload,
        )


@driver_router.post(
    "/{trip_id}/late-evidence", response_model=LateEvidenceRead, status_code=http_status.HTTP_201_CREATED,
    responses=_CONFLICTS, dependencies=[Depends(rate_limit(EVIDENCE_WRITE))],
)
async def submit_late_evidence_endpoint(
    trip_id: UUID, payload: LateEvidenceRequest,
    db: AsyncSession = Depends(get_db), current_driver: DriverRead = Depends(get_current_driver),
) -> LateEvidenceRead:
    """Retained for review; never advances a phase or changes custody."""
    with _domain_errors():
        return await retain_late_evidence(db, trip_id=trip_id, driver=current_driver, payload=payload)
