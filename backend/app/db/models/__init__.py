# FreightProof SA — SQLAlchemy declarative base. Every model file imports Base from
# here; all model classes are imported below so Alembic's env.py sees every table.

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import order matters: Base must be defined above before any model file is imported.
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
from app.db.models.phases import PhaseEvent, TrailerGpsSnapshot  # noqa: E402,F401
from app.db.models.transit import Checkpoint, TripException  # noqa: E402,F401
from app.db.models.locations import TripLocationPing  # noqa: E402,F401
from app.db.models.sessions import DriverSession, UserSession  # noqa: E402,F401
from app.db.models.sla import SlaConfig  # noqa: E402,F401
from app.db.models.events import DriverEvent, PrecinctEvent, VehicleEvent  # noqa: E402,F401
from app.db.models.handover import (  # noqa: E402,F401
    HandoverCapabilityToken,
    HandoverConfirmation,
    HandoverTokenAttempt,
)
from app.db.models.receiver_verification import (  # noqa: E402,F401
    IdvsQuotaLedger,
    ReceiverIdentityVerification,
)
from app.db.models.audit_packs import AuditPack, AuditPackAccessEvent, IncidentDeclaration  # noqa: E402,F401
