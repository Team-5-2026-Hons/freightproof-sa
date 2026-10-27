"""SQLAlchemy models for organizations and precincts."""

import uuid
from typing import Optional
from decimal import Decimal
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, column
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import OrganizationType


class Organization(Base):
    """Legal entity — transport operator, principal client, or both."""

    __tablename__ = "organizations"
    __table_args__ = (
        UniqueConstraint("pp_account_number", name="uq_organizations_pp_account_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    org_type: Mapped[OrganizationType] = mapped_column(String(50), nullable=False)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    pp_account_number: Mapped[Optional[str]] = mapped_column(String(6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


PP_HUB_CODE_INDEX = "uq_precincts_principal_pp_hub_code"


class Precinct(Base):
    """Physical depot or warehouse governed by a principal organization."""

    __tablename__ = "precincts"
    __table_args__ = (
        Index(
            PP_HUB_CODE_INDEX,
            "principal_organization_id",
            "pp_hub_code",
            unique=True,
            postgresql_where=column("pp_hub_code").is_not(None),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    principal_organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    latitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    geofence_radius_metres: Mapped[int] = mapped_column(Integer, nullable=False, server_default="200")
    geofence_polygon: Mapped[Optional[list[list[float]]]] = mapped_column(JSONB, nullable=True)
    is_shared: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    pp_hub_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
