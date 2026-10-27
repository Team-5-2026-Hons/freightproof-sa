"""Validate the authenticated driver's vehicle/seal/photo declaration without changing it."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import SubstitutionInvalidError
from app.db.models.driver_substitutions import DriverSubstitutionRequest, DriverSubstitutionUpload, DriverSubstitutionConfirmationArtifact
from app.db.models.enums import PhaseType, TripType
from app.db.models.evidence import EvidenceArtifact
from app.db.models.trips import Trip
from app.orchestration.substitutions.request_read import trip_vehicle_ids
from app.schemas.driver_substitutions import ConfirmSubstitutionRequest, ConfirmSubstitutionObservationRequest, SubstitutionRole

PRE_DEPARTURE_PHASES = frozenset({PhaseType.TRIP_CREATION.value, PhaseType.ACTIVATION.value, PhaseType.LOADING.value})


def seal_expected(trip: Trip) -> bool:
    """Whether this trip's seals must be read: a loaded trip from departure onward."""
    return trip.trip_type != TripType.EMPTY_LEG.value and trip.current_phase not in PRE_DEPARTURE_PHASES


async def validate_capture(
    db: AsyncSession, *, trip: Trip, request: DriverSubstitutionRequest, role: SubstitutionRole,
    payload: ConfirmSubstitutionRequest | ConfirmSubstitutionObservationRequest,
) -> None:
    """Refuse a capture that does not describe this trip's vehicles, seals and the caller's photos.

    Contract rules: both drivers cover the complete assigned horse/trailer set; one seal check
    per applicable vehicle (each trailer, or the horse when there are none); "not applicable" is
    an empty-leg or pre-departure answer only; every cited photo is the confirming driver's own handover upload
    for this request and role (C4: substitutions.artifacts), and not already backing another
    capture. A phase photo, the other driver's upload or another request's upload never counts.
    """
    driver_id = request.outgoing_driver_id if role is SubstitutionRole.OUTGOING else request.incoming_driver_id
    assigned = await trip_vehicle_ids(db, trip)
    if set(payload.confirmed_vehicle_ids) != set(assigned):
        raise SubstitutionInvalidError("The capture must cover exactly the trip's horse and trailers.")
    trailers = assigned[1:]
    applicable = set(trailers) if trailers else {trip.horse_id}
    if {check.vehicle_id for check in payload.seal_checks} != applicable:
        raise SubstitutionInvalidError("Each trailer (or the horse, when there is no trailer) needs one seal check.")
    if seal_expected(trip) and any(check.condition.value == "not_applicable" for check in payload.seal_checks):
        raise SubstitutionInvalidError(
            "A loaded trip's seals must be read once it has departed; "
            "'not applicable' is for an empty leg or a takeover before departure."
        )

    photo_ids = [photo for check in payload.seal_checks for photo in check.photo_artifact_ids]
    if len(set(photo_ids)) != len(photo_ids):
        raise SubstitutionInvalidError("A photo can back only one seal check.")
    if photo_ids:
        owned = set((await db.execute(
            select(EvidenceArtifact.id)
            .join(DriverSubstitutionUpload, DriverSubstitutionUpload.artifact_id == EvidenceArtifact.id)
            .where(
                EvidenceArtifact.id.in_(photo_ids), EvidenceArtifact.trip_id == trip.id,
                EvidenceArtifact.captured_by_driver_id == driver_id,
                DriverSubstitutionUpload.request_id == request.id, DriverSubstitutionUpload.role == role.value,
                DriverSubstitutionUpload.driver_id == driver_id,
            )
        )).scalars())
        reused = (await db.execute(
            select(DriverSubstitutionConfirmationArtifact.artifact_id)
            .where(DriverSubstitutionConfirmationArtifact.artifact_id.in_(photo_ids)).limit(1)
        )).first()
        if owned != set(photo_ids) or reused is not None:
            raise SubstitutionInvalidError(
                "A cited photo is not your own upload for this handover, or backs another capture."
            )
