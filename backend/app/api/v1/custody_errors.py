"""One rendering of the custody conflicts for every driver endpoint that can raise them.

The contract's FastAPI `detail` object is `{code, message, evidence_id?}`. Keeping the mapping
here stops seven endpoints each re-deriving the body (and one of them leaking more).
"""

from fastapi import HTTPException
from fastapi import status as http_status

from app.core.exceptions import CustodyAccessError, EvidenceAlreadyRecordedError, SubstitutionError
from app.schemas.driver_substitutions import SUBSTITUTION_ERROR_STATUS, SubstitutionErrorCode


def custody_http_exception(exc: CustodyAccessError) -> HTTPException:
    detail: dict[str, str] = {"code": exc.code, "message": exc.message}
    if isinstance(exc, EvidenceAlreadyRecordedError):
        detail["evidence_id"] = str(exc.evidence_id)
    return HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=detail)


def substitution_http_exception(exc: SubstitutionError) -> HTTPException:
    """FP-83 C6: a handover domain refusal as the contract's coded detail object. The status
    comes from the one per-code table in schemas (409, except 403 for identity authority and
    503 for the disabled flag), so no route can pick a different one."""
    detail: dict[str, str | int] = {"code": exc.code, "message": exc.message}
    if exc.request_id is not None:
        detail["request_id"] = str(exc.request_id)
    if exc.current_version is not None:
        detail["current_version"] = exc.current_version
    return HTTPException(status_code=SUBSTITUTION_ERROR_STATUS[SubstitutionErrorCode(exc.code)], detail=detail)
