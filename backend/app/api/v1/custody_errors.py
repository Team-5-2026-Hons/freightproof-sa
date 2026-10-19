"""One rendering of the custody conflicts for every driver endpoint that can raise them.

The contract's FastAPI `detail` object is `{code, message, evidence_id?}`. Keeping the mapping
here stops seven endpoints each re-deriving the body (and one of them leaking more).
"""

from fastapi import HTTPException
from fastapi import status as http_status

from app.core.exceptions import CustodyAccessError, EvidenceAlreadyRecordedError


def custody_http_exception(exc: CustodyAccessError) -> HTTPException:
    detail: dict[str, str] = {"code": exc.code, "message": exc.message}
    if isinstance(exc, EvidenceAlreadyRecordedError):
        detail["evidence_id"] = str(exc.evidence_id)
    return HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=detail)
