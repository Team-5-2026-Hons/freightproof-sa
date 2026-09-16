"""SQLAlchemy models for session tracking: the driver's single device, and the
last-seen record that makes the idle timeout enforceable for dispatchers. Supabase
issues and signs the tokens, so the backend cannot revoke one — instead it records
the session it recognises and refuses any other."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.models import Base


class DriverSession(Base):
    """The single session a driver's account is currently bound to."""

    __tablename__ = "driver_sessions"

    # driver_id IS the primary key (not a plain FK): a schema that could hold two rows
    # for one driver would let a race create the state this table exists to prevent.
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), primary_key=True
    )
    # Supabase's session_id claim, stored as a string not UUID since it's another
    # system's identifier.
    session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    # `iat` of the claiming token — decides which of two competing sessions is newer,
    # since the backend never sees a login event, only requests.
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UserSession(Base):
    """When each dispatcher session was last used, so an idle one can be refused
    (auth/sessions.enforce_idle_timeout). Keyed on session_id, not user_id, since a
    dispatcher may legitimately hold multiple sessions (desktop + laptop) at once,
    unlike DriverSession's one-per-driver."""

    __tablename__ = "user_sessions"

    # Supabase's session_id claim; same string-not-UUID reasoning as DriverSession.session_id.
    session_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    # `iat` of the opening token — the only activity floor available for a session
    # with no row yet.
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Indexed because the retention sweep filters on it.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
