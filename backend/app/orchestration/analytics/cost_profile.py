"""An organisation's cost rates for the Cost analytics tab (FP-294): read them, or save an
admin's change.

An organisation with no cost_profiles row uses DEFAULT_COST_RATES (the starting rates
worked out from Bruce's figures), so every operator sees figures from day one. The first
admin save inserts the row; later saves overwrite it (no history, spec D1).

Layering: imports analytics/, db/, core/ and schemas/ only. Its own module, so the fleet
service can load rates without importing analytics.metrics (independence contract).
"""

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics.cost_model import DEFAULT_COST_RATES, CostRates
from app.db.models.cost import CostProfile
from app.db.models.people import User
from app.schemas.cost_analytics import CostProfileRead, CostProfileUpdate

_RATE_FIELDS: dict[str, str] = {
    "diesel_price_per_litre": "diesel_price_per_litre",
    "litres_per_100km": "litres_per_100km",
    "running_cost_per_km": "running_per_km",
    "driver_cost_per_hour": "driver_per_hour",
    "delay_cost_per_hour": "delay_per_hour",
    "fixed_cost_per_trip": "fixed_per_trip",
    "road_factor": "road_factor",
}


def _rates_from_row(row: CostProfile) -> CostRates:
    return CostRates(**{rates_field: getattr(row, column) for column, rates_field in _RATE_FIELDS.items()})


async def _profile_row(db: AsyncSession, organization_id: uuid.UUID) -> CostProfile | None:
    result = await db.execute(
        select(CostProfile)
        .where(CostProfile.operator_organization_id == organization_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_cost_rates(
    db: AsyncSession, *, organization_id: uuid.UUID,
) -> tuple[CostRates, CostProfile | None]:
    """The rates the organisation's figures use, plus its row (None while on the defaults)."""
    row = await _profile_row(db, organization_id)
    return (DEFAULT_COST_RATES if row is None else _rates_from_row(row)), row


async def _editor_name(db: AsyncSession, *, organization_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    """Scoped to the organisation, like every name lookup here: a user from elsewhere names no one."""
    result = await db.execute(
        select(User.full_name).where(User.id == user_id, User.organization_id == organization_id)
    )
    return result.scalar_one_or_none()


def _to_read(rates: CostRates, row: CostProfile | None, editor_name: str | None) -> CostProfileRead:
    return CostProfileRead(
        diesel_price_per_litre=float(rates.diesel_price_per_litre),
        litres_per_100km=float(rates.litres_per_100km),
        fuel_per_km=float(rates.fuel_per_km),
        running_cost_per_km=float(rates.running_per_km),
        driver_cost_per_hour=float(rates.driver_per_hour),
        delay_cost_per_hour=float(rates.delay_per_hour),
        fixed_cost_per_trip=float(rates.fixed_per_trip),
        road_factor=float(rates.road_factor),
        is_default=row is None,
        updated_at=None if row is None else row.updated_at,
        updated_by_name=editor_name,
    )


async def rates_with_profile(db: AsyncSession, *, organization_id: uuid.UUID) -> tuple[CostRates, CostProfileRead]:
    """The rates to compute with, and how to show them (the Cost tab sends both)."""
    rates, row = await get_cost_rates(db, organization_id=organization_id)
    editor = (
        None if row is None
        else await _editor_name(db, organization_id=organization_id, user_id=row.updated_by_user_id)
    )
    return rates, _to_read(rates, row, editor)


async def read_cost_profile(db: AsyncSession, *, organization_id: uuid.UUID) -> CostProfileRead:
    _, profile = await rates_with_profile(db, organization_id=organization_id)
    return profile


async def update_cost_profile(
    db: AsyncSession, *, organization_id: uuid.UUID, data: CostProfileUpdate, user_id: uuid.UUID,
) -> CostProfileRead:
    """Save the rates the admin sent; any rate not sent keeps its current value.

    One INSERT ... ON CONFLICT statement rather than read-then-write, so two admins saving
    at the same moment for an organisation with no row yet can't both insert (the unique
    constraint would turn the loser's save into a 500).
    """
    changes: dict[str, Decimal] = {
        field: value for field, value in data.model_dump(exclude_none=True).items()
    }
    starting = {column: getattr(DEFAULT_COST_RATES, rates_field) for column, rates_field in _RATE_FIELDS.items()}
    statement = (
        insert(CostProfile)
        .values(
            id=uuid.uuid4(),
            operator_organization_id=organization_id,
            updated_by_user_id=user_id,
            **(starting | changes),
        )
        .on_conflict_do_update(
            index_elements=[CostProfile.operator_organization_id],
            set_={**changes, "updated_by_user_id": user_id, "updated_at": func.now()},
        )
    )
    await db.execute(statement)
    return await read_cost_profile(db, organization_id=organization_id)
