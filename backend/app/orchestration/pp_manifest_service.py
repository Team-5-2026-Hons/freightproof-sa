"""PP manifest preview and trip creation (FP-281, spec §10).

Layering: orchestration → integrations, crypto, db. Endpoints stay thin; this module
decides what a dispatcher may create from a manifest. Pure helpers live in pp_manifest.py.
"""

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConsignmentAlreadyAssignedError,
    PPManifestAlreadyOnTripError,
    PPManifestChangedError,
    PPManifestUnusableError,
    PPUnavailableError,
)
from app.crypto.hashing import compute_snapshot_sha256
from app.db.models.enums import TripStatus, TripType
from app.db.models.organisations import Organization, Precinct
from app.db.models.trips import Consignment, Trip
from app.integrations.parcel_perfect import PPManifestResponse, get_pp_client
from app.orchestration.consignment_service import scanned_consignment_ids
from app.orchestration.pp_manifest import (
    manifest_key,
    manifest_snapshot,
    manifest_totals,
    waybills_from_other_clients,
)
from app.orchestration.trip_service import (
    ManifestCargo,
    NewTrip,
    find_live_trip_for_manifest,
    persist_trip,
)
from app.schemas.people import UserRead
from app.schemas.pp_manifest import (
    BLOCKING_WARNING_CODES,
    PPManifestErrorCode,
    PPManifestHub,
    PPManifestNoteRead,
    PPManifestPreviewResponse,
    PPManifestRef,
    PPManifestTotalsRead,
    PPManifestWarning,
    PPManifestWarningCode,
    PPManifestWaybillLine,
    TripFromPPManifestRequest,
)
from app.schemas.trips import TripDetailResponse, TripStopCreate, validate_declared_schedule

logger = logging.getLogger(__name__)


def _visible_to(operator_organization_id: uuid.UUID) -> ColumnElement[bool]:
    """The precinct read rule (SEC-PRECINCT-1, as in precinct_service.list_precincts):
    a dispatcher sees their own organisation's precincts plus any marked is_shared. A
    manifest must neither reveal a depot the dispatcher cannot see nor route a trip into
    one, so both the hub lookup and the dispatcher's own pick apply it."""
    return or_(
        Precinct.principal_organization_id == operator_organization_id,
        Precinct.is_shared.is_(True),
    )


@dataclass(frozen=True)
class _ManifestContext:
    """A fetched manifest plus everything the database says about it."""

    manifest: PPManifestResponse
    snapshot: dict[str, Any]
    snapshot_sha256: str
    client: Organization | None
    origin_precinct: Precinct | None
    destination_precinct: Precinct | None
    warnings: list[PPManifestWarning]


async def _fetch_manifest(manifest_number: int) -> PPManifestResponse:
    """Outages become PPUnavailableError (502). PPManifestNotFoundError (404) and
    PPUnsupportedError (501) are not caught here: they propagate to the endpoint."""
    try:
        return await get_pp_client().get_manifest(manifest_number)
    except (ValueError, httpx.HTTPError) as exc:
        # The real client raises ValueError (PP errorcode != 0) or httpx errors.
        logger.warning("PP manifest lookup failed for %s: %s", manifest_number, exc)
        raise PPUnavailableError(str(exc)) from exc


async def _waybills_held_elsewhere(
    db: AsyncSession, refs: list[str], *, exclude_trip_id: uuid.UUID | None,
    operator_organization_id: uuid.UUID,
) -> dict[tuple[uuid.UUID | None, str | None], list[str]]:
    """Waybills another trip holds, grouped by (trip id, trip reference). A cancelled
    holder counts only if a parcel was scanned there: otherwise the waybill can move
    (spec §10.5)."""
    if not refs:
        return {}
    rows = (await db.execute(
        select(
            Consignment.id, Consignment.parcel_perfect_reference,
            Trip.id, Trip.trip_reference, Trip.status, Trip.operator_organization_id,
        )
        .join(Trip, Trip.id == Consignment.trip_id)
        .where(Consignment.parcel_perfect_reference.in_(refs))
    )).all()
    cancelled = [
        consignment_id for consignment_id, _, trip_id, _, status, _ in rows
        if status == TripStatus.CANCELLED and trip_id != exclude_trip_id
    ]
    scanned = await scanned_consignment_ids(db, cancelled)

    held: dict[tuple[uuid.UUID | None, str | None], list[str]] = defaultdict(list)
    for consignment_id, ref, trip_id, trip_reference, status, owner_id in rows:
        if trip_id == exclude_trip_id:
            continue  # the trip already holding this manifest is reported once, above
        if status == TripStatus.CANCELLED and consignment_id not in scanned:
            continue
        # Conflict detection is global; foreign trip identities remain tenant-private.
        identity = (trip_id, trip_reference) if owner_id == operator_organization_id else (None, None)
        held[identity].append(ref)
    return held


def _warning(code: PPManifestWarningCode, message: str, **extra: Any) -> PPManifestWarning:
    return PPManifestWarning(code=code, message=message, blocking=code in BLOCKING_WARNING_CODES, **extra)


async def _build_context(
    db: AsyncSession, manifest: PPManifestResponse, *, operator_organization_id: uuid.UUID,
) -> _ManifestContext:
    header = manifest.header
    snapshot = manifest_snapshot(manifest)
    label = f"{header.origin_hub} {header.manifest_number}"

    client = (await db.execute(
        select(Organization).where(Organization.pp_account_number == header.issuer_account)
    )).scalar_one_or_none()

    hubs: dict[str, Precinct] = {}
    if client is not None:
        # The issuing client's own depots only — RTT's JNB is not FedEx's JNB (spec §7.2) —
        # and only those this dispatcher may see. A private client depot is reported as an
        # unlinked hub, never named.
        result = await db.execute(
            select(Precinct).where(
                Precinct.principal_organization_id == client.id,
                Precinct.pp_hub_code.in_({header.origin_hub, header.destination_hub}),
                _visible_to(operator_organization_id),
            )
        )
        hubs = {p.pp_hub_code: p for p in result.scalars().all() if p.pp_hub_code is not None}
    origin = hubs.get(header.origin_hub)
    destination = hubs.get(header.destination_hub)

    existing = await find_live_trip_for_manifest(
        db, operator_organization_id=operator_organization_id, key=manifest_key(manifest),
    )
    held = await _waybills_held_elsewhere(
        db, [w.details.waybill for w in manifest.waybills],
        exclude_trip_id=existing.id if existing is not None else None,
        operator_organization_id=operator_organization_id,
    )

    warnings: list[PPManifestWarning] = []
    if existing is not None:
        warnings.append(_warning(
            PPManifestWarningCode.MANIFEST_ALREADY_ON_TRIP,
            f"Manifest {label} is already on trip {existing.trip_reference}.",
            trip_id=existing.id, trip_reference=existing.trip_reference,
        ))
    if client is None:
        warnings.append(_warning(
            PPManifestWarningCode.CLIENT_NOT_LINKED,
            f"PP account {header.issuer_account} ({header.issuer_name}) is not linked to any organisation.",
        ))
    mismatched = waybills_from_other_clients(manifest)
    if mismatched:
        warnings.append(_warning(
            PPManifestWarningCode.WAYBILL_CLIENT_MISMATCH,
            f"{len(mismatched)} waybill(s) belong to a different PP account than {header.issuer_account}.",
            waybills=mismatched,
        ))
    for (trip_id, trip_reference), refs in sorted(held.items(), key=lambda item: item[0][1] or ""):
        warnings.append(_warning(
            PPManifestWarningCode.WAYBILL_ON_OTHER_TRIP,
            f"{len(refs)} waybill(s) are already on "
            + (f"trip {trip_reference}." if trip_reference is not None else "another trip."),
            trip_id=trip_id, trip_reference=trip_reference, waybills=sorted(refs),
        ))
    if not manifest.waybills:
        warnings.append(_warning(
            PPManifestWarningCode.NO_WAYBILLS,
            "The manifest has no waybills — create an empty leg instead.",
        ))
    if client is not None and origin is None:
        warnings.append(_warning(
            PPManifestWarningCode.ORIGIN_HUB_UNLINKED,
            f"Hub {header.origin_hub} is not linked to a precinct — choose the origin precinct.",
        ))
    if client is not None and destination is None:
        warnings.append(_warning(
            PPManifestWarningCode.DESTINATION_HUB_UNLINKED,
            f"Hub {header.destination_hub} is not linked to a precinct — choose the destination precinct.",
        ))
    if header.planned_departure_at is None:
        warnings.append(_warning(
            PPManifestWarningCode.NO_PLANNED_TIMES,
            "The manifest has no planned departure — enter the planned times.",
        ))
    if header.closed_at is None:
        warnings.append(_warning(
            PPManifestWarningCode.MANIFEST_NOT_CLOSED,
            "The manifest is still open in Parcel Perfect. Waybills added after the trip is "
            "created will not be on it.",
        ))

    return _ManifestContext(
        manifest=manifest, snapshot=snapshot, snapshot_sha256=compute_snapshot_sha256(snapshot),
        client=client, origin_precinct=origin, destination_precinct=destination, warnings=warnings,
    )


def _hub(hub_code: str, precinct: Precinct | None) -> PPManifestHub:
    return PPManifestHub(
        hub_code=hub_code,
        precinct_id=precinct.id if precinct is not None else None,
        precinct_name=precinct.name if precinct is not None else None,
    )


def _preview(context: _ManifestContext) -> PPManifestPreviewResponse:
    header = context.manifest.header
    totals = manifest_totals(context.manifest)
    client_name = context.client.name if context.client is not None else header.issuer_name
    return PPManifestPreviewResponse(
        pp_manifest=PPManifestRef.of(
            issuer_account=header.issuer_account, origin_hub=header.origin_hub,
            number=header.manifest_number, client_name=client_name,
        ),
        snapshot_sha256=context.snapshot_sha256,
        client_organization_id=context.client.id if context.client is not None else None,
        client_name=client_name,
        origin=_hub(header.origin_hub, context.origin_precinct),
        destination=_hub(header.destination_hub, context.destination_precinct),
        planned_departure_at=header.planned_departure_at,
        expected_arrival_at=header.expected_arrival_at,
        is_closed=header.closed_at is not None,
        client_reference=header.client_reference,
        notes=[PPManifestNoteRead(noted_at=n.noted_at, operator=n.operator, text=n.text) for n in header.notes],
        totals=PPManifestTotalsRead(waybills=totals.waybills, parcels=totals.parcels, weight_kg=totals.weight_kg),
        waybills=[
            PPManifestWaybillLine(
                waybill=w.details.waybill, destination_town=w.details.dest_town,
                parcel_count=len(w.tracks), weight_kg=w.details.actual_weight_kg,
            )
            for w in sorted(context.manifest.waybills, key=lambda w: w.details.waybill)
        ],
        warnings=context.warnings,
        can_create=not any(w.blocking for w in context.warnings),
    )


async def preview_pp_manifest(
    db: AsyncSession, *, manifest_number: int, operator_organization_id: uuid.UUID,
) -> PPManifestPreviewResponse:
    """Read-only (spec §10.1): fetch, check, describe. Writes nothing.

    Raises:
        PPManifestNotFoundError, PPUnsupportedError, PPUnavailableError.
    """
    manifest = await _fetch_manifest(manifest_number)
    context = await _build_context(db, manifest, operator_organization_id=operator_organization_id)
    return _preview(context)


def _raise_for_blocking(context: _ManifestContext) -> None:
    """Refuse what the preview marked as blocking.

    WAYBILL_ON_OTHER_TRIP is deliberately left to the consignment sync: it raises the
    precise 409 (still assigned vs scanned on a cancelled trip), and it is the guard
    that holds under concurrency."""
    for warning in context.warnings:
        if not warning.blocking or warning.code is PPManifestWarningCode.WAYBILL_ON_OTHER_TRIP:
            continue
        if warning.code is PPManifestWarningCode.MANIFEST_ALREADY_ON_TRIP:
            raise PPManifestAlreadyOnTripError(trip_id=warning.trip_id, trip_reference=warning.trip_reference)
        raise PPManifestUnusableError(warning.code.value, warning.message)


async def _resolve_precinct(
    db: AsyncSession,
    linked: Precinct | None,
    requested_id: uuid.UUID | None,
    *,
    client: Organization,
    operator_organization_id: uuid.UUID,
    hub_code: str,
    role: str,
) -> Precinct:
    """The manifest's hub decides when it is linked. The dispatcher's pick is used only
    for an unlinked hub (spec §5). It must be one of the issuing client's precincts and
    one the dispatcher may see; one answer covers both cases, so a private depot's
    existence is not confirmed."""
    if linked is not None:
        return linked
    if requested_id is None:
        raise PPManifestUnusableError(
            PPManifestErrorCode.PRECINCT_REQUIRED.value,
            f"Hub {hub_code} is not linked to a precinct — choose the {role} precinct.",
        )
    precinct = (await db.execute(
        select(Precinct).where(
            Precinct.id == requested_id,
            Precinct.principal_organization_id == client.id,
            _visible_to(operator_organization_id),
        )
    )).scalar_one_or_none()
    if precinct is None:
        raise PPManifestUnusableError(
            PPManifestErrorCode.PRECINCT_NOT_AVAILABLE.value,
            f"The chosen {role} precinct is not one of {client.name}'s precincts available to you.",
        )
    return precinct


async def create_trip_from_pp_manifest(
    db: AsyncSession, payload: TripFromPPManifestRequest, current_user: UserRead,
) -> TripDetailResponse:
    """Spec §10.2, in one transaction, fail-closed.

    Raises:
        PPManifestNotFoundError, PPUnsupportedError, PPUnavailableError: from the fetch.
        PPManifestChangedError: the snapshot differs from what the dispatcher previewed.
        PPManifestAlreadyOnTripError: a non-cancelled trip holds this manifest.
        PPManifestUnusableError: a 422 case from §10.7.
        Everything persist_trip raises.
    """
    manifest = await _fetch_manifest(payload.manifest_number)
    context = await _build_context(db, manifest, operator_organization_id=current_user.organization_id)

    # 1. What the dispatcher reviewed must be what gets locked.
    if context.snapshot_sha256 != payload.expected_snapshot_sha256:
        raise PPManifestChangedError(payload.manifest_number, _preview(context).model_dump(mode="json"))

    _raise_for_blocking(context)
    client = context.client
    if client is None:  # _raise_for_blocking refused CLIENT_NOT_LINKED; narrows the type
        raise PPManifestUnusableError(PPManifestWarningCode.CLIENT_NOT_LINKED.value, "Client not linked.")

    # 2. Precincts: manifest first, the request only where a hub is unlinked.
    header = manifest.header
    origin = await _resolve_precinct(
        db, context.origin_precinct, payload.origin_precinct_id,
        client=client, operator_organization_id=current_user.organization_id,
        hub_code=header.origin_hub, role="origin",
    )
    destination = await _resolve_precinct(
        db, context.destination_precinct, payload.destination_precinct_id,
        client=client, operator_organization_id=current_user.organization_id,
        hub_code=header.destination_hub, role="destination",
    )
    if origin.id == destination.id:
        raise PPManifestUnusableError(
            PPManifestErrorCode.SAME_PRECINCT.value, "Origin and destination must be different precincts.",
        )

    # 3. Times: the request overrides the manifest. A departure is required after the
    #    merge — a trip without one can never be activated (_reject_if_not_due).
    departure = payload.planned_departure_at or header.planned_departure_at
    arrival = payload.planned_arrival_at or header.expected_arrival_at
    if departure is None:
        raise PPManifestUnusableError(
            PPManifestErrorCode.NO_PLANNED_DEPARTURE.value,
            "The manifest has no planned departure — enter one.",
        )
    try:
        validate_declared_schedule(departure, arrival)
    except ValueError as exc:
        raise PPManifestUnusableError(PPManifestErrorCode.SCHEDULE_INVALID.value, str(exc)) from exc

    # 4–9. Driver/vehicle checks, the trip, consignments from the manifest's own
    #      waybills, stops, phase plan, H0 snapshot, journey lock and anchor.
    try:
        return await persist_trip(
            db,
            NewTrip(
                driver_id=payload.driver_id,
                horse_id=payload.horse_id,
                trailer_ids=payload.trailer_ids,
                stops=[
                    TripStopCreate(precinct_id=origin.id, sequence=0),
                    TripStopCreate(precinct_id=destination.id, sequence=1),
                ],
                trip_type=TripType.LOADED,
                planned_departure_at=departure,
                planned_arrival_at=arrival,
                manifest=ManifestCargo(
                    key=manifest_key(manifest),
                    client_organization_id=client.id,
                    client_name=client.name,
                    waybills=manifest.waybills,
                    snapshot=context.snapshot,
                    snapshot_sha256=context.snapshot_sha256,
                ),
            ),
            current_user,
        )
    except ConsignmentAlreadyAssignedError as exc:
        # Sync rolled back the failed trip. Resolve the winning holder afresh:
        # ownership can change during creation, so preview-time facts are insufficient.
        owner_id = (await db.execute(
            select(Trip.operator_organization_id)
            .join(Consignment, Consignment.trip_id == Trip.id)
            .where(Consignment.parcel_perfect_reference == exc.pp_reference)
        )).scalar_one_or_none()
        if owner_id != current_user.organization_id:
            raise type(exc)(exc.pp_reference, None) from exc
        raise
