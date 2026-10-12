"""Record and read incident declarations — the police and notification facts an operator
supplies after an incident (SAPS station, CAS number, who was told when).

Append-only by design: a correction is a new declaration, so an audit pack can always
say what was declared and when. Nothing here reports anything to SAPS or an insurer —
FreightProof records, it does not respond (docs/scope-boundaries.md §0).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.db.models.audit_packs import IncidentDeclaration
from app.db.models.people import User
from app.db.models.transit import TripException
from app.db.models.trips import Trip
from app.schemas.audit_pack import IncidentDeclarationCreate, IncidentDeclarationRecord


async def _assert_trip(db: AsyncSession, trip_id: uuid.UUID, organization_id: uuid.UUID) -> None:
    found = (await db.execute(
        select(Trip.id).where(Trip.id == trip_id, Trip.operator_organization_id == organization_id)
    )).scalar_one_or_none()
    if found is None:
        raise ResourceNotFoundError("Trip", str(trip_id))


async def record_declaration(
    db: AsyncSession,
    *,
    trip_id: uuid.UUID,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    request: IncidentDeclarationCreate,
) -> IncidentDeclaration:
    await _assert_trip(db, trip_id, organization_id)
    if request.exception_id is not None:
        # Pinning a declaration to an exception on some other trip would put it in the
        # wrong trip's evidence pack.
        on_trip = (await db.execute(
            select(TripException.id).where(TripException.id == request.exception_id, TripException.trip_id == trip_id)
        )).scalar_one_or_none()
        if on_trip is None:
            raise ResourceNotFoundError("Exception", str(request.exception_id))

    row = IncidentDeclaration(
        id=uuid.uuid4(), trip_id=trip_id, declared_by_user_id=user_id,
        **request.model_dump(),
    )
    db.add(row)
    await db.flush()
    return row


def to_records(rows: Sequence[tuple[IncidentDeclaration, str | None]]) -> list[IncidentDeclarationRecord]:
    return [
        IncidentDeclarationRecord(
            declaration_id=row.id, exception_id=row.exception_id, saps_station=row.saps_station,
            saps_cas_number=row.saps_cas_number, saps_officer=row.saps_officer,
            reported_to_saps_at=row.reported_to_saps_at, tracking_company_notified_at=row.tracking_company_notified_at,
            insurer_notified_at=row.insurer_notified_at, client_notified_at=row.client_notified_at,
            insurer_claim_reference=row.insurer_claim_reference, note=row.note, declared_by_name=name,
            declared_at=row.created_at,
        )
        for row, name in rows
    ]


async def load_declarations(db: AsyncSession, *, trip_id: uuid.UUID) -> list[IncidentDeclarationRecord]:
    """Every declaration on the trip, oldest first, with the declarer's name."""
    rows = (await db.execute(
        select(IncidentDeclaration, User.full_name)
        .join(User, User.id == IncidentDeclaration.declared_by_user_id)
        .where(IncidentDeclaration.trip_id == trip_id)
        .order_by(IncidentDeclaration.created_at)
    )).tuples().all()
    return to_records(rows)


async def list_declarations(
    db: AsyncSession, *, trip_id: uuid.UUID, organization_id: uuid.UUID,
) -> list[IncidentDeclarationRecord]:
    await _assert_trip(db, trip_id, organization_id)
    return await load_declarations(db, trip_id=trip_id)
