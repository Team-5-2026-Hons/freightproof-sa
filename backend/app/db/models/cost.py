"""SQLAlchemy model for an organisation's cost rates (FP-294, the Cost analytics tab)."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class CostProfile(Base):
    """The rates an operator's cost estimates are worked out with, set by an admin dispatcher.

    One row per operator organisation, overwritten on each save: the Cost tab says every
    figure uses today's rates, so no history is kept. An organisation with no row uses the
    starting rates in app/analytics/cost_model.py, so the table needs no seed data.

    The CHECK bounds repeat MAX_LITRES_PER_100KM, MIN_ROAD_FACTOR and MAX_ROAD_FACTOR from
    app/core/constants.py as literals, because db/ imports nothing else from app/
    (CLAUDE.md layering). tests/unit/test_cost_model.py fails if the two ever disagree, so
    a value the API accepts is always one the database accepts.
    """

    __tablename__ = "cost_profiles"
    __table_args__ = (
        CheckConstraint(
            "diesel_price_per_litre >= 0 AND running_cost_per_km >= 0 AND driver_cost_per_hour >= 0 "
            "AND delay_cost_per_hour >= 0 AND fixed_cost_per_trip >= 0",
            name="ck_cost_profiles_rates_not_negative",
        ),
        CheckConstraint(
            "litres_per_100km > 0 AND litres_per_100km <= 200",
            name="ck_cost_profiles_litres_per_100km_range",
        ),
        CheckConstraint(
            "road_factor BETWEEN 1.00 AND 2.00", name="ck_cost_profiles_road_factor_range",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operator_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, unique=True,
    )
    diesel_price_per_litre: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    litres_per_100km: Mapped[Decimal] = mapped_column(Numeric(6, 1), nullable=False)
    running_cost_per_km: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    driver_cost_per_hour: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    delay_cost_per_hour: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fixed_cost_per_trip: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    road_factor: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    updated_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
