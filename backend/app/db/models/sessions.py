"""SQLAlchemy model for the one device a driver may be signed in on.

FreightProof's evidence rests on knowing WHO captured something. A driver account signed
in on two handsets breaks that in a way no amount of downstream validation can repair:
two people can walk two different phases of the same trip, and every timestamp, GPS fix
and photo afterwards is attributed to one identity that was in two places.

One row per driver, holding whichever session is currently allowed. Supabase issues and
signs the tokens, so the backend cannot revoke one — instead it records the session it
recognises, and refuses any request carrying a different, older one.
"""

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

    # driver_id IS the primary key, not a plain FK: "one active session per driver" is
    # the whole point, and a schema that can hold two rows for one driver would let a
    # race create exactly the state this table exists to prevent.
    driver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("drivers.id"), primary_key=True
    )
    # Supabase's session_id claim. A string, not a UUID column: it is an identifier from
    # another system, and storing it as an opaque token means a future auth provider with
    # a different id format doesn't need a migration.
    session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    # The `iat` of the token that claimed this session. This is what decides which of two
    # competing sessions is the newer one — the backend never sees a login event, only
    # requests, so "most recently issued token wins" is the only ordering available.
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
