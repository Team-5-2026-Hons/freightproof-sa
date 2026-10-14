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

# Idle time before a keep-alive comment, so proxies don't close the connection.
# Module-level so tests can shorten it.
HEARTBEAT_SECONDS = 15.0

# no-cache: SSE must never be cached. X-Accel-Buffering: no disables nginx response
# buffering, which would otherwise hold events back until the buffer fills.
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
    queue: asyncio.Queue[realtime.TripEvent] = asyncio.Queue()

    async def _pump() -> None:
        async for event in realtime.subscribe(org_id):
            await queue.put(event)

    pump_task = asyncio.create_task(_pump())
    try:
        yield ": connected\n\n"  # open the stream immediately, before the first real event
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            yield f"data: {event.model_dump_json()}\n\n"
    finally:
        # Client disconnected — stop the pump and let its Redis subscription tear down.
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
