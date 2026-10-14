"""Organisation-scoped visibility check for blockchain subjects.

Raises SubjectNotVisibleError — endpoint layer translates this to HTTP 404
so no information about other orgs is leaked.
"""

import uuid
from collections.abc import Callable, Mapping
from types import MappingProxyType

from sqlalchemy import SQLColumnExpression, Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SubjectNotVisibleError
from app.db.models.audit_packs import AuditPack
from app.db.models.enums import SubjectType
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.trips import Trip
from app.db.models.vehicles import Vehicle


# A query builder takes the subject id (a value, or a column when the query is used inside
# EXISTS) and the caller's organisation, and returns a select of the subject's id that has a
# row only when the subject belongs to that organisation.
type _VisibilityQuery = Callable[
    [uuid.UUID | SQLColumnExpression[uuid.UUID], uuid.UUID], Select[tuple[uuid.UUID]]
]


def _trip_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return select(Trip.id).where(
        Trip.id == subject_id,
        Trip.operator_organization_id == organization_id,
    )


def _vehicle_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return select(Vehicle.id).where(
        Vehicle.id == subject_id,
        Vehicle.organization_id == organization_id,
    )


def _driver_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return select(Driver.id).where(
        Driver.id == subject_id,
        Driver.organization_id == organization_id,
    )


def _vehicle_event_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return (
        select(VehicleEvent.id)
        .join(Vehicle, Vehicle.id == VehicleEvent.vehicle_id)
        .where(
            VehicleEvent.id == subject_id,
            Vehicle.organization_id == organization_id,
        )
    )


def _driver_event_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return (
        select(DriverEvent.id)
        .join(Driver, Driver.id == DriverEvent.driver_id)
        .where(
            DriverEvent.id == subject_id,
            Driver.organization_id == organization_id,
        )
    )


def _phase_event_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    # H2/H5 anchor receipts with the phase event as subject — scoped to
    # the org operating the trip the phase belongs to.
    return (
        select(PhaseEvent.id)
        .join(Trip, Trip.id == PhaseEvent.trip_id)
        .where(
            PhaseEvent.id == subject_id,
            Trip.operator_organization_id == organization_id,
        )
    )


def _precinct_event_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    # Scoped to the precinct's OWNER, not to who can see it. is_shared governs the
    # precinct list; it never opens the audit trail to another organisation.
    return (
        select(PrecinctEvent.id)
        .join(Precinct, Precinct.id == PrecinctEvent.precinct_id)
        .where(
            PrecinctEvent.id == subject_id,
            Precinct.principal_organization_id == organization_id,
        )
    )


def _audit_pack_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    # An issued pack's seal is the issuing operator's, like the trip it summarises.
    return select(AuditPack.id).where(
        AuditPack.id == subject_id,
        AuditPack.organization_id == organization_id,
    )


# One tenant rule per subject type. This is the blockchain half of the subject policy; the
# orchestration half (how a subject is rebuilt for verification) is the registry in
# orchestration/verification/service.py. They are two registries and not one object because
# blockchain/ sits below orchestration/ and may not import it.
SUBJECT_VISIBILITY_QUERIES: Mapping[SubjectType, _VisibilityQuery] = MappingProxyType({
    SubjectType.TRIP: _trip_visible,
    SubjectType.VEHICLE: _vehicle_visible,
    SubjectType.DRIVER: _driver_visible,
    SubjectType.VEHICLE_EVENT: _vehicle_event_visible,
    SubjectType.DRIVER_EVENT: _driver_event_visible,
    SubjectType.PHASE_EVENT: _phase_event_visible,
    SubjectType.PRECINCT_EVENT: _precinct_event_visible,
    SubjectType.AUDIT_PACK: _audit_pack_visible,
})

# Subject types that have no tenant rule and so are never visible to anyone. Empty today: it
# exists so that leaving a new SubjectType out of the registry is a decision written down here,
# and a test fails until someone makes it.
NEVER_VISIBLE_SUBJECT_TYPES: frozenset[SubjectType] = frozenset()


def subject_visibility_query(
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID],
    organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    """Share the same tenant rules between single-subject checks and receipt queries."""
    build_query = SUBJECT_VISIBILITY_QUERIES.get(subject_type)
    if build_query is None:
        raise SubjectNotVisibleError(str(subject_type), str(subject_id))
    return build_query(subject_id, organization_id)


async def assert_subject_visible(
    db: AsyncSession,
    *,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> None:
    """Raise SubjectNotVisibleError if subject is outside the caller's organisation."""
    query = subject_visibility_query(
        subject_type=subject_type,
        subject_id=subject_id,
        organization_id=organization_id,
    )
    result = await db.execute(query.limit(1))
    if result.scalar_one_or_none() is None:
        raise SubjectNotVisibleError(str(subject_type), str(subject_id))
