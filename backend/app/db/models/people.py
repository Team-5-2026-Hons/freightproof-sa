"""SQLAlchemy models for dispatcher users and drivers."""

import uuid
from typing import Optional
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import IdvsStatus

# Read by orchestration when naming the field a unique violation actually clashed on.
UQ_DRIVERS_ORG_ID_NUMBER = "uq_drivers_org_id_number"


class User(Base):
    """Dispatcher account. id must equal the Supabase auth.users UUID so that
    auth.uid() resolves correctly in RLS policies and the JWT sub claim maps
    directly to this row without a secondary lookup column."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Driver(Base):
    """Driver entity — authenticates via phone OTP, not email/password."""

    __tablename__ = "drivers"
    __table_args__ = (
        # One SA ID number, one driver record per organisation. create_driver has
        # always caught a unique violation and reported it as a duplicate id_number,
        # but no such constraint existed — the branch was unreachable and duplicates
        # were accepted. Phone numbers are guarded upstream by Supabase Auth; the
        # ID number, which is the identity this record is anchored to, was not
        # guarded anywhere.
        UniqueConstraint("organization_id", "id_number", name=UQ_DRIVERS_ORG_ID_NUMBER),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    id_number: Mapped[str] = mapped_column(String(13), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    license_number: Mapped[str] = mapped_column(String(50), nullable=False)
    license_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    idvs_status: Mapped[IdvsStatus] = mapped_column(String(20), nullable=False, server_default="pending")
    idvs_last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
