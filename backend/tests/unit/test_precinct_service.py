"""Unit tests for precinct service org scoping, write semantics and anchoring.

Uses the db_session fixture (real Postgres, rolled back per test) rather than mocks —
the whole point of these functions is the WHERE clause, and a mocked session would
assert nothing about it. anchor_subject is patched so no test hits Hedera.
"""

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DuplicateResourceError, ResourceNotFoundError
from app.db.models.blockchain import BlockchainReceipt
from app.db.models.enums import (
    BlockchainReceiptType, OrganizationType, PrecinctEventType, SubjectType,
)
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User
from app.orchestration.precinct_service import create_precinct, list_precincts, update_precinct
from app.orchestration.verification_service import (
    _hash_payload,
    _reconstruct_precinct_event_payload,
)
from app.schemas.organisations import PrecinctCreateBody, PrecinctUpdateBody


async def _seed(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Return (own_org_id, other_org_id, user_id). The user belongs to own_org."""
    own = Organization(id=uuid.uuid4(), name="Own Org", org_type=OrganizationType.OPERATOR)
    other = Organization(id=uuid.uuid4(), name="Other Org", org_type=OrganizationType.PRINCIPAL)
    db.add_all([own, other])
    await db.flush()

    # changed_by_user_id is a NOT NULL FK to users — every write needs a real actor.
    user = User(
        id=uuid.uuid4(), organization_id=own.id,
        email="admin@own.co.za", full_name="Admin", is_active=True,
    )
    db.add(user)
    await db.flush()
    return own.id, other.id, user.id


def _body(**overrides) -> PrecinctCreateBody:
    payload = {
        "name": "Riverhorse Valley",
        "address": "12 Sookhai Place, Durban",
        "latitude": -29.7942,
        "longitude": 30.9820,
        "geofence_radius_metres": 200,
    }
    payload.update(overrides)
    return PrecinctCreateBody(**payload)


async def _fake_receipt(db: AsyncSession) -> BlockchainReceipt:
    """A persisted BlockchainReceipt row.

    anchor_subject is mocked out entirely for these tests, so its real body — which
    normally inserts this row (db.add(receipt); await db.flush()) before returning it —
    never runs. precinct_events.blockchain_receipt_id is a real NOT NULL-checked FK
    against blockchain_receipts.id, so the service's `event.blockchain_receipt_id =
    receipt.id` assignment fails on the next flush unless the row genuinely exists.
    Values other than .id are filler to satisfy the row's own NOT NULL columns.
    """
    receipt = BlockchainReceipt(
        id=uuid.uuid4(),
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=uuid.uuid4(),
        receipt_type=BlockchainReceiptType.PRECINCT_CREATED,
        data_hash="0" * 64,
        payload_json={},
    )
    db.add(receipt)
    await db.flush()
    return receipt


async def test_create_precinct_saves_against_the_callers_org(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    assert created.principal_organization_id == own_org_id
    row = (
        await db_session.execute(select(Precinct).where(Precinct.id == created.id))
    ).scalar_one()
    assert row.principal_organization_id == own_org_id
    assert row.latitude == Decimal("-29.7942000")
    assert row.geofence_radius_metres == 200


async def test_create_precinct_writes_a_created_event_and_anchors_it(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch("app.orchestration.precinct_service.anchor_subject", new=anchor):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalar_one()
    assert event.event_type == "created"
    assert event.changed_by_user_id == user_id
    assert event.blockchain_receipt_id == receipt.id

    anchor.assert_awaited_once()
    assert anchor.await_args is not None
    kwargs = anchor.await_args.kwargs
    assert kwargs["subject_type"] == SubjectType.PRECINCT_EVENT
    assert kwargs["subject_id"] == event.id
    assert kwargs["receipt_type"] == BlockchainReceiptType.PRECINCT_CREATED


async def test_created_anchor_payload_carries_the_geofence_in_the_clear(db_session: AsyncSession):
    """No PII in a precinct, so nothing is hashed — and the payload must be the
    geofence, because that is what a later verification needs to reproduce."""
    own_org_id, _, user_id = await _seed(db_session)
    anchor = AsyncMock(return_value=await _fake_receipt(db_session))

    with patch("app.orchestration.precinct_service.anchor_subject", new=anchor):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    assert anchor.await_args is not None
    payload = anchor.await_args.kwargs["canonical_payload"]
    assert payload["fields"]["latitude"] == -29.7942
    assert payload["fields"]["longitude"] == 30.9820
    assert payload["fields"]["geofence_radius_metres"] == 200
    assert payload["event_type"] == "created"


async def test_created_precinct_appears_in_list_for_its_own_org(db_session: AsyncSession):
    """The FP-68 handoff: a precinct is useless until trip creation can see it."""
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        created = await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Newly Mapped Depot"), current_user_id=user_id,
        )

    listed = await list_precincts(db=db_session, organization_id=own_org_id)

    assert [p.id for p in listed] == [created.id]
    assert listed[0].name == "Newly Mapped Depot"


async def test_created_precinct_is_private_to_its_org_by_default(db_session: AsyncSession):
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(), current_user_id=user_id,
        )

    assert await list_precincts(db=db_session, organization_id=other_org_id) == []


async def test_created_precinct_is_visible_cross_org_when_shared(db_session: AsyncSession):
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(is_shared=True), current_user_id=user_id,
        )

    seen = await list_precincts(db=db_session, organization_id=other_org_id)

    assert len(seen) == 1
    assert seen[0].principal_organization_id == own_org_id


async def test_create_rejects_a_duplicate_name_within_the_same_org(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )

        with pytest.raises(DuplicateResourceError):
            await create_precinct(
                db=db_session, organization_id=own_org_id,
                data=_body(name="Depot A"), current_user_id=user_id,
            )


async def test_same_name_is_allowed_in_a_different_org(db_session: AsyncSession):
    """The check is per-org. Two companies may both have a 'Linbro Park' depot."""
    own_org_id, other_org_id, user_id = await _seed(db_session)

    with patch(
        "app.orchestration.precinct_service.anchor_subject",
        new=AsyncMock(return_value=await _fake_receipt(db_session)),
    ):
        await create_precinct(
            db=db_session, organization_id=own_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )
        created = await create_precinct(
            db=db_session, organization_id=other_org_id,
            data=_body(name="Depot A"), current_user_id=user_id,
        )

    assert created.name == "Depot A"


_ANCHOR = "app.orchestration.precinct_service.anchor_subject"


async def _create(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, **overrides):
    # _fake_receipt is async and persists a real BlockchainReceipt row — see its
    # docstring. A bare AsyncMock(return_value=_fake_receipt()) would hand back an
    # unawaited coroutine, not a receipt, and fail the FK on event.blockchain_receipt_id.
    receipt = await _fake_receipt(db)
    with patch(_ANCHOR, new=AsyncMock(return_value=receipt)):
        return await create_precinct(
            db=db, organization_id=org_id,
            data=_body(**overrides), current_user_id=user_id,
        )


async def test_update_precinct_applies_only_supplied_fields(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id, name="Original Name")

    receipt = await _fake_receipt(db_session)
    with patch(_ANCHOR, new=AsyncMock(return_value=receipt)):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )

    assert updated.geofence_radius_metres == 350
    assert updated.name == "Original Name"
    assert updated.latitude == -29.7942


async def test_moving_a_precinct_anchors_a_relocated_event(db_session: AsyncSession):
    """The FP-68 case: correcting a facility's position after a bad first entry."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch(_ANCHOR, new=anchor):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(latitude=-26.0942, longitude=28.1342),
            current_user_id=user_id,
        )

    assert updated.latitude == -26.0942

    events = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.precinct_id == created.id)
            .order_by(PrecinctEvent.created_at)
        )
    ).scalars().all()
    assert events[-1].event_type == PrecinctEventType.RELOCATED.value
    assert set(events[-1].changed_fields.keys()) == {"latitude", "longitude"}

    anchor.assert_awaited_once()
    assert anchor.await_args is not None
    assert anchor.await_args.kwargs["receipt_type"] == BlockchainReceiptType.PRECINCT_UPDATED


async def test_resizing_the_geofence_anchors_a_resized_event(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.GEOFENCE_RESIZED.value)
        )
    ).scalar_one()
    assert event.changed_fields["geofence_radius_metres"] == {"from": 200, "to": 350}
    anchor.assert_awaited_once()


async def test_toggling_sharing_anchors_a_sharing_event(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(is_shared=True), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.SHARING_CHANGED.value)
        )
    ).scalar_one()
    assert event.changed_fields["is_shared"] == {"from": False, "to": True}
    anchor.assert_awaited_once()


async def test_a_rename_is_logged_but_never_anchored(db_session: AsyncSession):
    """A cosmetic edit costs no Hedera fee. The absent receipt is the assertion."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch(_ANCHOR, new=anchor):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Renamed Depot"), current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.COSMETIC_UPDATE.value)
        )
    ).scalar_one()
    assert event.blockchain_receipt_id is None
    assert event.changed_fields["name"] == {"from": "Riverhorse Valley", "to": "Renamed Depot"}
    anchor.assert_not_awaited()


async def test_a_move_and_a_resize_together_are_labelled_relocated(db_session: AsyncSession):
    """Priority is deliberate: a move is the more significant fact, and the full diff
    in changed_fields loses nothing by the label."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)

    receipt = await _fake_receipt(db_session)
    with patch(_ANCHOR, new=AsyncMock(return_value=receipt)):
        await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(latitude=-26.0942, geofence_radius_metres=400),
            current_user_id=user_id,
        )

    event = (
        await db_session.execute(
            select(PrecinctEvent)
            .where(PrecinctEvent.event_type == PrecinctEventType.RELOCATED.value)
        )
    ).scalar_one()
    assert set(event.changed_fields.keys()) == {"latitude", "geofence_radius_metres"}


async def test_update_precinct_owned_by_another_org_raises_not_found(db_session: AsyncSession):
    """404, not 403 — a caller must not be able to probe another org's rows."""
    own_org_id, other_org_id, user_id = await _seed(db_session)
    theirs = await _create(db_session, other_org_id, user_id)

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=theirs.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )


async def test_update_shared_precinct_not_owned_raises_not_found(db_session: AsyncSession):
    """Visibility is not permission. is_shared lets you SEE it, never edit it."""
    own_org_id, other_org_id, user_id = await _seed(db_session)
    theirs = await _create(db_session, other_org_id, user_id, is_shared=True)

    visible = await list_precincts(db=db_session, organization_id=own_org_id)
    assert [p.id for p in visible] == [theirs.id]

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=theirs.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(geofence_radius_metres=350), current_user_id=user_id,
        )


async def test_update_precinct_unknown_id_raises_not_found(db_session: AsyncSession):
    own_org_id, _, user_id = await _seed(db_session)

    with pytest.raises(ResourceNotFoundError):
        await update_precinct(
            db=db_session, precinct_id=uuid.uuid4(), organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Ghost"), current_user_id=user_id,
        )


async def test_empty_patch_writes_no_event_and_no_anchor(db_session: AsyncSession):
    """Nothing changed, so there is nothing to record. An event log that fills with
    no-ops stops being readable as a history."""
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id)
    receipt = await _fake_receipt(db_session)
    anchor = AsyncMock(return_value=receipt)

    with patch(_ANCHOR, new=anchor):
        updated = await update_precinct(
            db=db_session, precinct_id=created.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(), current_user_id=user_id,
        )

    assert updated.name == created.name
    events = (
        await db_session.execute(
            select(PrecinctEvent).where(PrecinctEvent.precinct_id == created.id)
        )
    ).scalars().all()
    assert len(events) == 1  # the CREATED event only
    anchor.assert_not_awaited()


async def test_rename_onto_an_existing_name_in_the_same_org_raises_duplicate(
    db_session: AsyncSession,
):
    own_org_id, _, user_id = await _seed(db_session)
    await _create(db_session, own_org_id, user_id, name="Depot A")
    second = await _create(db_session, own_org_id, user_id, name="Depot B")

    with pytest.raises(DuplicateResourceError):
        await update_precinct(
            db=db_session, precinct_id=second.id, organization_id=own_org_id,
            data=PrecinctUpdateBody(name="Depot A"), current_user_id=user_id,
        )


async def test_a_mixed_patch_anchors_exactly_what_the_ledger_row_records(
    db_session: AsyncSession,
):
    """A PATCH touching a critical AND a cosmetic field must stay verifiable.

    verification_service rebuilds the anchored payload from the event row's
    changed_fields column. If update_precinct anchors only the critical half of a mixed
    diff, the two hashes diverge and verify reports DB_MISMATCH on a record nobody
    touched. This asserts the round trip rather than the payload's literal shape, so it
    keeps its teeth if either side's key set is ever changed.
    """
    own_org_id, _, user_id = await _seed(db_session)
    created = await _create(db_session, own_org_id, user_id, name="Original Name")

    anchored: dict = {}
    receipt = await _fake_receipt(db_session)

    async def _capture(db, *, canonical_payload, **kwargs) -> BlockchainReceipt:
        anchored.update(canonical_payload)
        return receipt

    with patch(_ANCHOR, new=AsyncMock(side_effect=_capture)):
        await update_precinct(
            db=db_session,
            precinct_id=created.id,
            organization_id=own_org_id,
            data=PrecinctUpdateBody(latitude=-26.1000, name="Renamed Depot"),
            current_user_id=user_id,
        )

    rebuilt = await _reconstruct_precinct_event_payload(
        db_session, uuid.UUID(anchored["precinct_event_id"])
    )

    assert rebuilt is not None
    assert set(anchored["fields"]) == {"latitude", "name"}
    assert _hash_payload(anchored) == _hash_payload(rebuilt)
