# FreightProof SA — SQLAlchemy declarative base.
# Every model file in this package imports Base from here and subclasses it.
# All model classes are imported below so that Alembic's env.py sees every
# table in Base.metadata when autogenerating or applying migrations.

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import order matters for circular-import safety: Base must be defined above
# before any model file is imported (each file does `from app.db.models import Base`).
from app.db.models.organisations import Organization, Precinct  # noqa: E402,F401
from app.db.models.people import Driver, User  # noqa: E402,F401
from app.db.models.vehicles import Vehicle  # noqa: E402,F401
from app.db.models.trips import (  # noqa: E402,F401
    Consignment,
    DriverSubstitution,
    Parcel,
    Trip,
    TripStop,
    TripTemplate,
    TripTrailer,
)
from app.db.models.evidence import EvidenceArtifact  # noqa: E402,F401
from app.db.models.blockchain import (  # noqa: E402,F401
    BlockchainReceipt,
    MerkleBatch,
    MerkleBatchLeaf,
)
from app.db.models.handshakes import HandshakeEvent, TrailerGpsSnapshot  # noqa: E402,F401
from app.db.models.transit import Checkpoint, TripException  # noqa: E402,F401
from app.db.models.sla import SlaConfig  # noqa: E402,F401
from app.db.models.events import DriverEvent, VehicleEvent  # noqa: E402,F401
