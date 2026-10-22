"""FastAPI router for the dispatcher assistant (the bottom-right helper bubble).

POST /assistant/chat    answer one question from the organisation's live records
GET  /assistant/status  whether the assistant is on, and this month's AI spend

Any dispatcher may use it (get_current_dispatcher, spec D9): every read its tools make is one the
dispatcher's own pages already allow, and it never writes. The organisation always comes from the
token, never the request or the model.

Thin by design: validate (AssistantRequest), call orchestration/assistant/service.py, and turn its
expected failures into status codes, with the same messages as the Analytics chat:
  AssistantDisabledError  → 503 (switched off, no key, or an unpriced model)
  BudgetSpentError        → 429 (the shared monthly budget is used up, or it can't be checked)
  ChatCreditError         → 503 (the provider account has run out of credit)
  ChatQuotaError          → 503 (the provider's allowance is used up for now)
  ChatProviderFailedError → 502 (the model provider didn't answer)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.analytics_chat import CREDIT_DETAIL, PROVIDER_FAILED_DETAIL, QUOTA_DETAIL
from app.auth.dependencies import get_current_dispatcher
from app.core.limits import ASSISTANT_CHAT
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.analytics_chat.service import ChatCreditError, ChatProviderFailedError, ChatQuotaError
from app.orchestration.assistant.service import AssistantDisabledError, ask, assistant_status
from app.schemas.assistant import AssistantAnswer, AssistantRequest, AssistantStatus
from app.schemas.people import UserRead

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.post(
    "/chat",
    response_model=AssistantAnswer,
    summary="Answer a dispatcher's question from the organisation's live records, with cards of the records used",
    dependencies=[Depends(rate_limit(ASSISTANT_CHAT))],
)
async def ask_assistant_endpoint(
    body: AssistantRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> AssistantAnswer:
    try:
        return await ask(db, user=current_user, request=body)
    except AssistantDisabledError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except BudgetSpentError as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    except ChatCreditError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=CREDIT_DETAIL) from exc
    except ChatQuotaError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=QUOTA_DETAIL) from exc
    except ChatProviderFailedError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=PROVIDER_FAILED_DETAIL) from exc


@router.get(
    "/status",
    response_model=AssistantStatus,
    summary="Whether the dispatcher assistant is on, and this month's AI spend",
)
async def get_assistant_status_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> AssistantStatus:
    return await assistant_status(current_user)
