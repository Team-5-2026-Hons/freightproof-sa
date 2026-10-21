"""SQLAlchemy model for the push tokens a driver's device registers, so the backend can
reach the driver with a GATE_ARRIVAL notification."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base

# FCM registration tokens run to roughly 160-200 characters; APNs device tokens are 64 hex.
# Headroom for either service lengthening its format, but kept well under the ~2700-byte
# btree entry limit: the unique index on token would reject a longer value with a 500.
PUSH_TOKEN_MAX_LENGTH = 1024


class DriverPushToken(Base):
    """One device token, owned by the driver who last registered it."""

    __tablename__ = "driver_push_tokens"
    # Unique, not unique per driver: a token names a device install, and a shared device that
    # changes hands must stop notifying the previous driver the moment the new one registers.
    __table_args__ = (UniqueConstraint("token", name="uq_driver_push_tokens_token"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(PUSH_TOKEN_MAX_LENGTH), nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    # Refreshed on every registration, so a sender can prefer recent tokens and a sweep can
    # drop ones that have not been seen since the app was uninstalled.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
