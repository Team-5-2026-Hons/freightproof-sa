"""Queries behind the Evidence tab (GET /analytics/fleet/evidence, spec §5.5).

How strong the record is. Tracker agreement, overrides and receiver sign-off are over the
closed-trip set (spec G4), each step bucketed by its trip's first departure. The blockchain
receipts chart (D25) and the Receipts owed tile (D26) were both removed.
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.fleet.base import closed_trips, trip_steps
from app.analytics.fleet.periods import Bucket, InstantRange, Period, buckets, instant_range, require_grain
from app.analytics.views import ATTESTED_PHASE_STATUSES
from app.db.models.enums import PhaseType
from app.db.models.handover import HandoverConfirmation, HandoverTokenAttempt
from app.db.models.trips import Trip
from app.schemas.fleet_analytics import (
    EvidenceResponse,
    OverridesBucket,
    PeriodEcho,
    ReceiverSignoffBucket,
    SignoffFlags,
    TrackerBucket,
)


def _zero_filled(counts: Mapping[date, tuple[int, ...]], bucket_list: Sequence[Bucket], width: int) -> list[tuple[Bucket, tuple[int, ...]]]:
    """Every bucket of the period with its counts, zeros where nothing happened (spec G7)."""
    return [(bucket, counts.get(bucket.start, (0,) * width)) for bucket in bucket_list]


async def tracker(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[TrackerBucket]:
    """Chart 5.1, the facility view's definition: attested steps at a stop (trip_creation has
    none), in_transit excluded (corroboration never gives it a verdict), by geofence result."""
    steps = trip_steps(closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period)))
    verdict = steps.c.pulsit_geofence_confirmed
    result = await db.execute(
        select(
            steps.c.bucket_start,
            func.count().filter(verdict.is_(True)),
            func.count().filter(verdict.is_(False)),
            func.count().filter(verdict.is_(None)),
        )
        .where(
            steps.c.status.in_(ATTESTED_PHASE_STATUSES),
            steps.c.phase_type != PhaseType.IN_TRANSIT,
            steps.c.trip_stop_id.is_not(None),
        )
        .group_by(steps.c.bucket_start)
    )
    counts = {bucket_start: (confirmed, mismatch, unwitnessed) for bucket_start, confirmed, mismatch, unwitnessed in result.tuples().all()}
    return [
        TrackerBucket(
            bucket_start=bucket.start, is_partial=bucket.is_partial,
            confirmed_count=values[0], mismatch_count=values[1], unwitnessed_count=values[2],
        )
        for bucket, values in _zero_filled(counts, buckets(period), 3)
    ]


async def overrides(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[OverridesBucket]:
    """Chart 5.2: every step of every closed trip, and how many a dispatcher overrode. The same
    denominator as the driver view's phase_events_count, so the two shares agree."""
    steps = trip_steps(closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period)))
    result = await db.execute(
        select(
            steps.c.bucket_start,
            func.count(),
            func.count().filter(steps.c.dispatcher_override_user_id.is_not(None)),
        ).group_by(steps.c.bucket_start)
    )
    counts = {bucket_start: (steps_count, overridden) for bucket_start, steps_count, overridden in result.tuples().all()}
    return [
        OverridesBucket(bucket_start=bucket.start, is_partial=bucket.is_partial, phase_count=values[0], override_count=values[1])
        for bucket, values in _zero_filled(counts, buckets(period), 2)
    ]


async def receiver_signoff(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> list[ReceiverSignoffBucket]:
    """Chart 5.7: attested sign-off steps of the closed-trip set, and how many carry a receiver
    confirmation. The confirmation is unique per step, so the outer join never double-counts."""
    steps = trip_steps(closed_trips(organization_id, instant_range(period.start, period.end), require_grain(period)))
    result = await db.execute(
        select(steps.c.bucket_start, func.count(), func.count(HandoverConfirmation.id))
        .select_from(steps)
        .outerjoin(HandoverConfirmation, HandoverConfirmation.phase_event_id == steps.c.phase_event_id)
        .where(
            steps.c.phase_type == PhaseType.CONFIRMATION,
            steps.c.status.in_(ATTESTED_PHASE_STATUSES),
        )
        .group_by(steps.c.bucket_start)
    )
    counts = {bucket_start: (total, scanned) for bucket_start, total, scanned in result.tuples().all()}
    return [
        ReceiverSignoffBucket(
            bucket_start=bucket.start, is_partial=bucket.is_partial,
            confirmation_count=values[0], receiver_scan_count=values[1],
        )
        for bucket, values in _zero_filled(counts, buckets(period), 2)
    ]


async def signoff_flags(db: AsyncSession, *, organization_id: uuid.UUID, window: InstantRange) -> SignoffFlags:
    """The period's two warning figures for chart 5.7. Rejected attempts carry no foreign key
    to a trip (an unknown token has none), so they are matched to the organisation through the
    trip they were presented against."""
    same_phone = await db.execute(
        select(func.count())
        .select_from(HandoverConfirmation)
        .join(Trip, Trip.id == HandoverConfirmation.trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            HandoverConfirmation.bearer_token_present.is_(True),
            HandoverConfirmation.confirmed_at >= window.start,
            HandoverConfirmation.confirmed_at < window.end,
        )
    )
    rejected = await db.execute(
        select(func.count())
        .select_from(HandoverTokenAttempt)
        .join(Trip, Trip.id == HandoverTokenAttempt.presented_trip_id)
        .where(
            Trip.operator_organization_id == organization_id,
            HandoverTokenAttempt.rejection_reason.is_not(None),
            HandoverTokenAttempt.attempted_at >= window.start,
            HandoverTokenAttempt.attempted_at < window.end,
        )
    )
    return SignoffFlags(same_phone_count=same_phone.scalar_one(), rejected_attempt_count=rejected.scalar_one())


async def build_evidence(db: AsyncSession, *, organization_id: uuid.UUID, period: Period) -> EvidenceResponse:
    tracked = await tracker(db, organization_id=organization_id, period=period)
    overridden = await overrides(db, organization_id=organization_id, period=period)
    signoff = await receiver_signoff(db, organization_id=organization_id, period=period)
    flags = await signoff_flags(db, organization_id=organization_id, window=instant_range(period.start, period.end))
    return EvidenceResponse(
        period=PeriodEcho(start=period.start, end=period.end, grain=period.grain),
        tracker=tracked,
        overrides=overridden,
        receiver_signoff=signoff,
        signoff_flags=flags,
    )
