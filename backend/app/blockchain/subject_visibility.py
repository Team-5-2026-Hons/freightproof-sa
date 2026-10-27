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
from app.db.models.driver_substitutions import DriverSubstitutionCorrection
from app.db.models.enums import SubjectType
from app.db.models.evidence_anchors import EvidenceAnchorEvent
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent
from app.db.models.organisations import Precinct
from app.db.models.phases import PhaseEvent
from app.db.models.people import Driver
from app.db.models.transit import TripException
from app.db.models.trips import DriverSubstitution, Trip
from app.db.models.vehicles import Vehicle


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
    return select(AuditPack.id).where(
        AuditPack.id == subject_id,
        AuditPack.organization_id == organization_id,
    )


def _evidence_event_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return (
        select(EvidenceAnchorEvent.id)
        .join(TripException, TripException.id == EvidenceAnchorEvent.exception_id)
        .join(Trip, Trip.id == TripException.trip_id)
        .where(
            EvidenceAnchorEvent.id == subject_id,
            EvidenceAnchorEvent.trip_id == TripException.trip_id,
            Trip.operator_organization_id == organization_id,
        )
    )


def _driver_substitution_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return (
        select(DriverSubstitution.id)
        .join(Trip, Trip.id == DriverSubstitution.trip_id)
        .where(DriverSubstitution.id == subject_id, Trip.operator_organization_id == organization_id)
    )


def _driver_substitution_correction_visible(
    subject_id: uuid.UUID | SQLColumnExpression[uuid.UUID], organization_id: uuid.UUID,
) -> Select[tuple[uuid.UUID]]:
    return (
        select(DriverSubstitutionCorrection.id)
        .join(DriverSubstitution, DriverSubstitution.id == DriverSubstitutionCorrection.substitution_id)
        .join(Trip, Trip.id == DriverSubstitution.trip_id)
        .where(DriverSubstitutionCorrection.id == subject_id, Trip.operator_organization_id == organization_id)
    )


SUBJECT_VISIBILITY_QUERIES: Mapping[SubjectType, _VisibilityQuery] = MappingProxyType({
    SubjectType.TRIP: _trip_visible,
    SubjectType.VEHICLE: _vehicle_visible,
    SubjectType.DRIVER: _driver_visible,
    SubjectType.VEHICLE_EVENT: _vehicle_event_visible,
    SubjectType.DRIVER_EVENT: _driver_event_visible,
    SubjectType.PHASE_EVENT: _phase_event_visible,
    SubjectType.PRECINCT_EVENT: _precinct_event_visible,
    SubjectType.AUDIT_PACK: _audit_pack_visible,
    SubjectType.EVIDENCE_EVENT: _evidence_event_visible,
    SubjectType.DRIVER_SUBSTITUTION: _driver_substitution_visible,
    SubjectType.DRIVER_SUBSTITUTION_CORRECTION: _driver_substitution_correction_visible,
})

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
