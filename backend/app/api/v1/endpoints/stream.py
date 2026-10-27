"""Server-Sent Events endpoint — the dispatcher's live channel (app/core/realtime.py).

Org is taken from the authenticated dispatcher — that's the security boundary. One
directional (server -> browser), which is why SSE fits over a WebSocket.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_dispatcher
from app.core import realtime
from app.schemas.people import UserRead

router = APIRouter(prefix="/stream", tags=["stream"])
logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 15.0

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


async def _event_stream(org_id: UUID) -> AsyncIterator[str]:
    """Yield SSE frames for one connected dispatcher until they disconnect.

    A background task pumps events from the org's Redis subscription into a queue; the
    main loop drains it, timing out to a heartbeat when idle. Timeout wraps the queue
    read, not the Redis subscription, so cancellation stays clean.
    """
    queue: asyncio.Queue[realtime.TripEvent | None] = asyncio.Queue()

    async def _pump() -> None:
        try:
            async for event in realtime.subscribe(org_id):
                await queue.put(event)
        except Exception:
            logger.exception("Realtime subscription failed: org=%s", org_id)
        finally:
            queue.put_nowait(None)

    pump_task = asyncio.create_task(_pump())
    try:
        yield ": connected\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            if event is None:
                logger.warning("Realtime subscription ended; closing stream: org=%s", org_id)
                return
            yield f"data: {event.model_dump_json()}\n\n"
    finally:
        pump_task.cancel()
        with suppress(asyncio.CancelledError):
            await pump_task


@router.get("", summary="Live dispatcher event stream (Server-Sent Events)")
async def stream_endpoint(
    current_user: UserRead = Depends(get_current_dispatcher),
) -> StreamingResponse:
    return StreamingResponse(
        _event_stream(current_user.organization_id),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
