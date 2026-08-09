"""Hub-to-hub checkpoint for the driver-submitted arrival attestation (Task 7 of
docs/superpowers/plans/2026-08-09-in-transit-driver-owned-arrival.md).

Scope fence: single origin, single destination, two stops, exactly one
`in_transit` row per trip. Multi-stop cross-dock is deliberately out of scope.

Written as a checkpoint BEFORE Task 8 deleted `_gate_and_load`'s IN_TRANSIT
exclusion and `advance_unloading`'s in_transit-closing side effect, so that the
new arrival path was proven end to end on the simple case before anything
load-bearing was removed. Both are now gone, and these tests pass either way —
they submit the arrival explicitly rather than relying on a side effect, which
is exactly why they survived the removal unchanged.

Supersedes a throwaway diagnostic, `test_v3_override_hole_probe.py`, which was
never committed — do not go looking for it in the history. It printed outcomes
rather than asserting them, and its own docstring asked to be deleted "once ...
a real regression test exists." These three tests assert the ground it walked,
now that arrival gives the dispatcher override path something to close against.
"""

import uuid
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.enums import PhaseStatus, PhaseType, TripStatus
from app.db.models.phases import PhaseEvent
from app.db.models.trips import Trip

from tests.conftest import auth_header, make_token
from tests.integration.test_phases import (
    _complete_in_transit, _fake_hedera_receipt, _make_artifact, _walk_to_in_transit,
)
from tests.integration.test_trip_admin import (  # noqa: F401  (fixtures)
    _dispatcher_token, _make_trip, _phase_id, override_get_db,
)


async def _phase_row(db_session, trip_id, phase_type: PhaseType) -> PhaseEvent:
    return (await db_session.execute(
        select(PhaseEvent).where(
            PhaseEvent.trip_id == trip_id, PhaseEvent.phase_type == phase_type,
        )
    )).scalar_one()


async def test_arrival_timestamp_precedes_the_unloading_submission(
    client: AsyncClient, db_session, seed,
):
    """The reason this change exists.

    Before this change, in_transit was auto-completed as a side effect of
    advance_unloading, so in_transit.completed_at and unloading.completed_at
    were the SAME instant — every dispatcher-visible "drive time" (departure
    to arrival) silently included the whole unloading phase. With arrival as
    its own driver-submitted attestation, in_transit closes strictly before
    unloading is ever submitted.
    """
    trip = await _make_trip(db_session, seed, order_number="ARR-TS-1")
    # Captured before any expire_all() below — expiring the session invalidates
    # trip's loaded attributes, and a later trip.id access would trigger a lazy
    # load outside a greenlet context (MissingGreenlet), the same sharp edge
    # noted in test_phases.py's replay-ordering test.
    trip_id = trip.id
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, driver_token)
    await _complete_in_transit(client, trip, driver_token)

    gate_photo_id = await _make_artifact(db_session, trip_id)
    unloading_id = await _phase_id(client, trip_id, driver_token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    departure = await _phase_row(db_session, trip_id, PhaseType.DEPARTURE)
    in_transit = await _phase_row(db_session, trip_id, PhaseType.IN_TRANSIT)
    unloading = await _phase_row(db_session, trip_id, PhaseType.UNLOADING)

    assert departure.completed_at is not None
    assert in_transit.completed_at is not None
    assert unloading.completed_at is not None
    assert departure.completed_at <= in_transit.completed_at
    assert in_transit.completed_at < unloading.completed_at


async def test_full_hub_to_hub_walk_with_arrival_closes_the_trip(
    client: AsyncClient, db_session, seed,
):
    """activation -> loading -> departure -> arrival -> unloading -> confirmation,
    all driver-submitted, over live HTTP. The trip must still close, and the new
    in_transit row must be COMPLETED (not left PENDING, not silently skipped)."""
    trip = await _make_trip(db_session, seed, order_number="ARR-FULL-1")
    trip_id = trip.id  # captured before expire_all() — see MissingGreenlet note above
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    await _walk_to_in_transit(client, db_session, trip, driver_token)
    await _complete_in_transit(client, trip, driver_token)

    gate_photo_id = await _make_artifact(db_session, trip_id)
    unloading_id = await _phase_id(client, trip_id, driver_token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{unloading_id}/complete",
        json={
            "phase_type": "unloading", "seal_number_at_destination": "AB-1234",
            "gate_photo_artifact_id": gate_photo_id, "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth_header(driver_token),
    )
    assert resp.status_code == 200, resp.text

    pod_photo_id = await _make_artifact(db_session, trip_id)
    pod_signature_id = await _make_artifact(db_session, trip_id)
    confirmation_id = await _phase_id(client, trip_id, driver_token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip_id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42, "pp_scan_in_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(driver_token),
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "closed"
    assert body.get("current_phase") is None

    db_session.expire_all()
    in_transit = await _phase_row(db_session, trip_id, PhaseType.IN_TRANSIT)
    fresh_trip = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()

    assert PhaseStatus(in_transit.status) == PhaseStatus.COMPLETED
    assert TripStatus(fresh_trip.status) == TripStatus.CLOSED
    assert fresh_trip.current_phase is None


async def test_overridden_unloading_still_closes_the_trip_when_arrival_was_submitted(
    client: AsyncClient, db_session, seed,
):
    """The V3 strand from the lifecycle audit, now structurally closed.

    The strand existed because nothing but advance_unloading could resolve
    in_transit: overriding unloading skipped that side effect entirely, left
    in_transit PENDING forever, and recompute_position stops at the first
    unresolved row — it never reached its close-the-trip branch. The load was
    genuinely delivered and the dispatcher board permanently read "driving".

    With the driver submitting arrival themselves before unloading is ever
    reached, in_transit is already resolved by the time a dispatcher overrides
    unloading, so the override path now closes cleanly.

    The dispatcher's in_transit override control stays regardless of this fix
    — it remains the correct recovery for a driver whose phone dies mid-drive
    and can therefore never submit an arrival attestation at all.
    """
    trip = await _make_trip(db_session, seed, order_number="ARR-V3-1")
    trip_id = trip.id  # captured before expire_all() — see MissingGreenlet note above
    driver_token = make_token(sub=str(seed["driver"].id), role="driver")
    dispatcher_token = _dispatcher_token(seed)
    await _walk_to_in_transit(client, db_session, trip, driver_token)
    await _complete_in_transit(client, trip, driver_token)

    unloading_id = await _phase_id(client, trip_id, driver_token, "unloading")
    resp = await client.post(
        f"/api/v1/trips/{trip_id}/phases/{unloading_id}/override",
        json={"note": "warehouse gate scanner offline, closing unloading manually"},
        headers=auth_header(dispatcher_token),
    )
    assert resp.status_code == 200, resp.text

    pod_photo_id = await _make_artifact(db_session, trip_id)
    pod_signature_id = await _make_artifact(db_session, trip_id)
    confirmation_id = await _phase_id(client, trip_id, driver_token, "confirmation")
    with patch("app.blockchain.anchor_service.HederaService") as MockService:
        MockService.return_value.submit_hash.return_value = _fake_hedera_receipt()
        resp = await client.post(
            f"/api/v1/trips/{trip_id}/phases/{confirmation_id}/complete",
            json={
                "phase_type": "confirmation",
                "pod_photo_artifact_id": pod_photo_id, "pod_signature_artifact_id": pod_signature_id,
                "driver_visual_count": 42, "pp_scan_in_count": 42,
                "idempotency_key": str(uuid.uuid4()),
            },
            headers=auth_header(driver_token),
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "closed"

    db_session.expire_all()
    fresh_trip = (await db_session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    assert TripStatus(fresh_trip.status) == TripStatus.CLOSED
