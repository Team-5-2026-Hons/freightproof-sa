"""Trip exceptions — the driver raising one, and the dispatcher resolving it."""

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExceptionAlreadyResolvedError, ResourceNotFoundError
from app.core.realtime import RealtimeKind, TripEvent, enqueue_event, event_severity
from app.db.models.enums import (
    ExceptionResolutionMethod,
    ExceptionSeverity,
    ExceptionSource,
    ExceptionType,
)
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip
from app.db.models.transit import TripException
from app.orchestration.phase_service import current_phase_event
from app.schemas.transit import TripExceptionRead

logger = logging.getLogger(__name__)

# Mirrors TripContext.tsx's criticalTypes set on the frontend — keep these two in sync.
_CRITICAL_TYPES = {ExceptionType.PANIC_BUTTON, ExceptionType.SEAL_BROKEN_IN_TRANSIT, ExceptionType.SEAL_MISMATCH}


async def _resolve_phase_context(
    db: AsyncSession, *, trip_id: uuid.UUID, claimed_phase_event_id: uuid.UUID | None,
) -> PhaseEvent | None:
    """The phase this exception happened ON, decided once at creation and then frozen.

    A client-supplied id wins over server derivation deliberately. The driver app queues
    exceptions offline and flushes them when signal returns (driver-pwa
    lib/hooks/useOfflineQueue.ts), so a panic raised mid-transit can arrive here after
    the trip has already reached unloading — deriving at request time would tag it with
    the wrong phase, which is the exact drift this tagging exists to remove. The client
    knows where the driver WAS; this process only knows where the trip IS now.

    A claimed id belonging to some other trip is dropped and logged rather than
    rejected: the offline queue treats 4xx as terminal and discards the entry, so
    422-ing a stale client would silently lose the alert. Recording a panic with
    server-derived placement beats not recording it at all.
    """
    if claimed_phase_event_id is not None:
        result = await db.execute(
            select(PhaseEvent).where(
                PhaseEvent.id == claimed_phase_event_id,
                PhaseEvent.trip_id == trip_id,
            )
        )
        claimed = result.scalar_one_or_none()
        if claimed is not None:
            return claimed
        logger.warning(
            "Exception claimed phase_event_id=%s, which is not on trip=%s — ignoring the "
            "claim and falling back to server-derived phase context.",
            claimed_phase_event_id, trip_id,
        )

    return await current_phase_event(db, trip_id)


async def raise_exception(
    db: AsyncSession, *, trip_id: uuid.UUID, driver_id: uuid.UUID,
    exception_type: ExceptionType, description: str, supporting_artifact_id: uuid.UUID | None,
    phase_event_id: uuid.UUID | None = None,
    gps_lat: Decimal | None = None, gps_lng: Decimal | None = None,
) -> TripExceptionRead:
    """Raises ResourceNotFoundError if the trip doesn't exist, PermissionError if
    driver_id isn't the trip's assigned driver (caller maps PermissionError to 403).

    phase_event_id is where the driver was when this happened, as the client observed
    it — see _resolve_phase_context for why the claim is trusted and what happens when
    it is absent or foreign.

    gps_lat/gps_lng are the driver-phone fix captured by the panic page (spec: "Your
    GPS location will be included") — both-or-neither is already enforced by
    DriverExceptionCreateBody's validator before this is called, so no re-check here."""
    result = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise ResourceNotFoundError("Trip", str(trip_id))
    if trip.driver_id != driver_id:
        raise PermissionError("You are not the assigned driver on this trip.")

    phase_event = await _resolve_phase_context(
        db, trip_id=trip_id, claimed_phase_event_id=phase_event_id,
    )

    # Bound before the row rather than inlined into it: the realtime event below must
    # carry the same severity the row is written with. While these were two separate
    # expressions the event did not carry one at all — every driver-raised exception
    # published as ordinary, so a PANIC_BUTTON (CRITICAL, _CRITICAL_TYPES above) reached
    # the dispatcher quieter than a system-detected parcel-count mismatch. Reading both
    # from one binding is what makes that unable to recur.
    severity = (
        ExceptionSeverity.CRITICAL if exception_type in _CRITICAL_TYPES
        else ExceptionSeverity.WARNING
    )

    exc = TripException(
        trip_id=trip_id,
        phase_event_id=phase_event.id if phase_event is not None else None,
        # Scope to the stop that phase is anchored to, exactly as the system-detected
        # exceptions in phase_service already do (parcel/waybill count mismatches).
        # Nullable throughout: trip_creation carries no stop, and neither does an
        # exception on a trip with no plan.
        trip_stop_id=phase_event.trip_stop_id if phase_event is not None else None,
        exception_type=exception_type,
        source=ExceptionSource.DRIVER,
        severity=severity,
        description=description,
        supporting_artifact_id=supporting_artifact_id,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
    )
    db.add(exc)
    await db.flush()
    await db.refresh(exc)

    # Notify dispatchers watching this trip so the exception surfaces live (published on
    # commit, D9). A thin ping — the exception's GPS/description never crosses the channel.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(severity),
        ),
    )

    return TripExceptionRead.model_validate(exc)


def _read_with_trip(exc: TripException, trip: Trip) -> TripExceptionRead:
    """Serialise an exception with the reference of the trip it belongs to.

    The trip comes from the org-scoping join both callers already perform, so this adds
    no query. Without it every exception row on the dispatcher's queue would say only
    which UUID it belonged to, and both screens would fetch the whole trip list to turn
    that into something a human can act on.
    """
    return TripExceptionRead.model_validate(exc).model_copy(
        update={"trip_reference": trip.trip_reference},
    )


async def resolve_exception(
    db: AsyncSession,
    *,
    exception_id: uuid.UUID,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    resolver_note: str,
    resolution_method: ExceptionResolutionMethod,
) -> TripExceptionRead:
    """Record how a dispatcher resolved an exception.

    The site visit found resolution happening informally — a phone call, a WhatsApp
    message, a word in the yard — and none of it reaching the record. An exception
    marked resolved with no trace of *how* is an assertion; with the method and the
    resolver's note it is evidence about the handling. This records that the contact
    happened. It does not place calls or send messages.

    **The server owns the resolver and the clock.** `resolved_by_user_id` comes from the
    token and `resolved_at` from this process, never from the request body — which is why
    this takes a narrow note+method rather than the existing TripExceptionUpdate, whose
    shape would let a caller name someone else as the resolver at a time of their
    choosing. An evidence record where the client picks its own author is not evidence.

    Org scoping is authorisation, not a filter: the join to Trip means a dispatcher
    cannot resolve another operator's exception by guessing a UUID. A miss raises
    ResourceNotFoundError (→ 404) rather than a 403, because a 403 confirms the row
    exists to someone with no right to know it.

    The FIRST resolution is the evidence, always — overwriting it with a second note
    would rewrite the record of who established what, and when. What happens to the
    second call depends on WHO makes it:

    * **Same dispatcher** — idempotent. A double-tap and a replayed request both carry
      the same account, so the stored row comes back unchanged and nothing is lost.
    * **A different dispatcher** — ``ExceptionAlreadyResolvedError`` (→ 409). Their note
      and method are being discarded, and they may have established something the first
      resolver did not. Returning 200 with a colleague's note would tell them their
      account was recorded when it was not.

    A row whose ``resolved_by_user_id`` is NULL (resolved before that column was
    captured) counts as a different dispatcher: we cannot prove otherwise.

    Raises:
        ResourceNotFoundError: no such exception in this organisation.
        ExceptionAlreadyResolvedError: another dispatcher resolved it first.
    """
    # Joined rather than fetched separately: the org check and the load are one question
    # ("is there such an exception that this dispatcher may act on"), and splitting them
    # invites a later edit that answers only half of it.
    row = (await db.execute(
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            TripException.id == exception_id,
            Trip.operator_organization_id == organization_id,
        )
    )).one_or_none()
    if row is None:
        raise ResourceNotFoundError("TripException", str(exception_id))
    exc, trip = row

    if exc.resolved:
        # Same dispatcher: a double-tap, or a request the client retried. Their account
        # is already the record, so there is nothing to lose and nothing to report —
        # return the stored row exactly as before.
        if exc.resolved_by_user_id == user_id:
            logger.info(
                "Resolve replayed by the same user: exception=%s org=%s",
                exception_id, organization_id,
            )
            return _read_with_trip(exc, trip)
        # A different dispatcher got there first — or the row predates resolver capture
        # (NULL), where we cannot prove it was this caller and must not assume it. Either
        # way this call's note and method are about to be dropped, and the caller has to
        # be told: they may have established something the first resolver did not.
        logger.info(
            "Resolve conflicted, already resolved by another user: exception=%s org=%s "
            "first_resolver=%s caller=%s",
            exception_id, organization_id, exc.resolved_by_user_id, user_id,
        )
        raise ExceptionAlreadyResolvedError(str(exception_id))

    exc.resolved = True
    exc.resolved_by_user_id = user_id
    exc.resolved_at = datetime.now(UTC)
    exc.resolver_note = resolver_note
    exc.resolution_method = resolution_method
    await db.flush()
    await db.refresh(exc)

    # Metadata only. resolver_note is free text a dispatcher typed about a person and
    # about a live incident; it belongs in the record, never in the log.
    logger.info(
        "Exception resolved: exception=%s trip=%s by=%s method=%s",
        exception_id, exc.trip_id, user_id, resolution_method.value,
    )

    # Other dispatchers in the org are looking at the same list. INFO severity: a
    # resolution is progress, not an alarm — it must refresh a screen without
    # interrupting whoever is working through the queue.
    enqueue_event(
        db, trip.operator_organization_id,
        TripEvent(
            id=exc.trip_id, kind=RealtimeKind.EXCEPTION_RAISED,
            severity=event_severity(ExceptionSeverity.INFO),
        ),
    )

    return _read_with_trip(exc, trip)


async def list_exceptions(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    resolved: bool | None = None,
) -> list[TripExceptionRead]:
    """Every exception on the organisation's trips, newest first.

    Scoped by joining Trip rather than by filtering a column on TripException, because
    the exception table carries no organisation of its own — the trip owns that, and
    deriving it here keeps a single source for who may see what.

    `resolved=None` means "all", and is not the same as False. The detail page looks one
    exception up by id without knowing its state, and an unresolved-only default would
    make a resolved exception unopenable from its own permalink.

    Ordered newest-first: this backs a queue a dispatcher works down, and the thing that
    just happened is the thing they need.

    `id` breaks the tie, and is not decoration. `created_at` is `server_default=func.now()`,
    which in Postgres is the TRANSACTION timestamp — so every exception written by one
    request shares an identical value, and `advance_confirmation` alone can write three.
    On `created_at` alone their relative order is whatever the planner returns, which can
    differ between two fetches of the same data; the queue would reshuffle under a
    dispatcher reading it.
    """
    stmt = (
        select(TripException, Trip)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(Trip.operator_organization_id == organization_id)
        .order_by(TripException.created_at.desc(), TripException.id.desc())
    )
    if resolved is not None:
        stmt = stmt.where(TripException.resolved.is_(resolved))

    rows = (await db.execute(stmt)).all()
    return [_read_with_trip(exc, trip) for exc, trip in rows]
