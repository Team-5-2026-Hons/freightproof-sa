"""Server-Sent Events endpoint — the dispatcher's live channel.

A dispatcher opens one long-lived connection here and receives thin change
notifications for their organisation (see app/core/realtime.py). The org is taken
from the authenticated dispatcher, so a dispatcher can only ever receive their own
organisation's events — that is the security boundary, and there is nothing to
configure in the database for it.

The stream is one-directional (server → browser): the dispatcher never sends
anything back over it, which is exactly why SSE fits and a bidirectional WebSocket
would be over-tooling.
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

# How long the stream may sit idle before it emits a keep-alive comment. Proxies and
# load balancers close idle connections; a periodic comment frame keeps the pipe open
# without the client having to reconnect. Module-level so tests can shorten it.
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
    main loop drains the queue, and any interval with no event produces a heartbeat
    comment instead. Wrapping the queue read (rather than the Redis subscription itself)
    in the timeout keeps cancellation clean — a cancelled ``queue.get()`` is harmless,
    whereas cancelling a mid-flight Redis read could leave the pubsub in a bad state.
    """
    queue: asyncio.Queue[realtime.TripEvent] = asyncio.Queue()

    async def _pump() -> None:
        async for event in realtime.subscribe(org_id):
            await queue.put(event)

    pump_task = asyncio.create_task(_pump())
    try:
        # Open the stream immediately so the client (and any proxy) sees a live
        # connection before the first real event arrives.
        yield ": connected\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            yield f"data: {event.model_dump_json()}\n\n"
    finally:
        # Client disconnected (the generator is closed) — stop the pump and let its
        # Redis subscription tear down.
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
