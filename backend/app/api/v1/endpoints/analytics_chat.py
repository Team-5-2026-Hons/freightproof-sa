"""FastAPI router for the Analytics chat panel (FP-295).

POST /analytics/chat         answer one question about the fleet figures
GET  /analytics/chat/status  whether the chat is on, and this month's AI spend

Mounted under /analytics by endpoints/analytics.py, so the shared main.py needs no change.
Any dispatcher may use it (get_current_dispatcher): it only reads figures the Analytics page
already shows. The organisation always comes from the token, never the request or the model.

Thin by design: validate (ChatRequest), call orchestration/analytics_chat/service.py, and turn
its three expected failures into status codes:
  ChatDisabledError → 503 (switched off, no key, or an unpriced model)
  BudgetSpentError  → 429 (monthly budget used up, or it can't be checked)
  ChatCreditError   → 503 (the provider account has run out of credit)
  ChatQuotaError    → 503 (the provider's allowance is used up for now)
  ChatProviderFailedError → 502 (the model provider didn't answer)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_dispatcher
from app.core.limits import ANALYTICS_CHAT
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.orchestration.analytics_chat.budget import BudgetSpentError
from app.orchestration.analytics_chat.service import (
    ChatCreditError,
    ChatDisabledError,
    ChatProviderFailedError,
    ChatQuotaError,
    ask,
    chat_status,
)
from app.schemas.analytics_chat import ChatAnswer, ChatRequest, ChatStatus
from app.schemas.people import UserRead

router = APIRouter(prefix="/chat", tags=["analytics"])

PROVIDER_FAILED_DETAIL = "The AI service didn't answer. Try again."
CREDIT_DETAIL = "The AI account has run out of credit. It needs topping up before the chat can answer."
QUOTA_DETAIL = "The AI's allowance is used up for now. If it stays that way, the daily allowance resets at 09:00."


@router.post(
    "",
    response_model=ChatAnswer,
    summary="Answer a question from the fleet analytics figures, with what each answer is based on",
    dependencies=[Depends(rate_limit(ANALYTICS_CHAT))],
)
async def ask_analytics_chat_endpoint(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ChatAnswer:
    try:
        return await ask(db, user=current_user, request=body)
    except ChatDisabledError as exc:
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
    response_model=ChatStatus,
    summary="Whether the analytics chat is on, and this organisation's AI spend this month",
)
async def get_analytics_chat_status_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> ChatStatus:
    return await chat_status(current_user)
