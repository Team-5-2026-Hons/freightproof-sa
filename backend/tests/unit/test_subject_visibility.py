"""Unit tests for blockchain subject visibility — no HTTP layer."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.blockchain.subject_visibility import assert_subject_visible
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import OrganizationType, SubjectType
from app.db.models.events import PrecinctEvent
from app.db.models.organisations import Organization, Precinct
from app.db.models.people import User


@pytest.mark.asyncio
async def test_visible_subject_does_not_raise() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = uuid.uuid4()
    db.execute.return_value = result
    await assert_subject_visible(
        db, subject_type=SubjectType.TRIP,
        subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
    )


@pytest.mark.asyncio
async def test_invisible_subject_raises() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result
    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db, subject_type=SubjectType.TRIP,
            subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_handshake_event_subject_visible_does_not_raise() -> None:
    """H2/H5 anchor receipts carry subject_type=handshake_event — the visibility
    gate must resolve them via the owning trip's operator organisation (this
    branch was missing, so dispatchers got 404 verifying driver anchors)."""
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = uuid.uuid4()
    db.execute.return_value = result
    await assert_subject_visible(
        db, subject_type=SubjectType.PHASE_EVENT,
        subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
    )


@pytest.mark.asyncio
async def test_handshake_event_outside_org_raises() -> None:
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute.return_value = result
    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db, subject_type=SubjectType.PHASE_EVENT,
            subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_unknown_subject_type_raises() -> None:
    db = AsyncMock()
    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db, subject_type="nonexistent",  # type: ignore[arg-type]
            subject_id=uuid.uuid4(), organization_id=uuid.uuid4(),
        )


# ── PRECINCT_EVENT branch — exercised against a real DB session, not a mock,   ──
# ── because the visibility rule here (owner-only, is_shared never grants read) ──
# ── is a security boundary worth proving against actual query semantics.      ──


async def _seed_precinct_event(db: AsyncSession, *, is_shared: bool = False):
    """Return (event_id, owner_org_id, other_org_id)."""
    owner = Organization(id=uuid.uuid4(), name="Owner", org_type=OrganizationType.PRINCIPAL)
    other = Organization(id=uuid.uuid4(), name="Other", org_type=OrganizationType.OPERATOR)
    db.add_all([owner, other])
    await db.flush()

    user = User(
        id=uuid.uuid4(), organization_id=owner.id,
        email="a@b.co.za", full_name="A", is_active=True,
    )
    precinct = Precinct(
        id=uuid.uuid4(), principal_organization_id=owner.id, name="Depot",
        latitude="-29.7942", longitude="30.9820", is_shared=is_shared,
    )
    db.add_all([user, precinct])
    await db.flush()

    event = PrecinctEvent(
        id=uuid.uuid4(), precinct_id=precinct.id, event_type="created",
        changed_fields={}, changed_by_user_id=user.id,
    )
    db.add(event)
    await db.flush()
    return event.id, owner.id, other.id


async def test_precinct_event_visible_to_the_owning_org(db_session: AsyncSession):
    event_id, owner_org_id, _ = await _seed_precinct_event(db_session)

    await assert_subject_visible(
        db_session,
        subject_type=SubjectType.PRECINCT_EVENT,
        subject_id=event_id,
        organization_id=owner_org_id,
    )


async def test_precinct_event_not_visible_to_another_org(db_session: AsyncSession):
    event_id, _, other_org_id = await _seed_precinct_event(db_session)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=event_id,
            organization_id=other_org_id,
        )


async def test_a_shared_precincts_events_stay_private_to_its_owner(db_session: AsyncSession):
    """is_shared governs the precinct list, never its audit trail. Another org may
    plan trips into this facility; it does not get to read who moved its gate."""
    event_id, _, other_org_id = await _seed_precinct_event(db_session, is_shared=True)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=event_id,
            organization_id=other_org_id,
        )


async def test_unknown_precinct_event_id_is_not_visible(db_session: AsyncSession):
    _, owner_org_id, _ = await _seed_precinct_event(db_session)

    with pytest.raises(SubjectNotVisibleError):
        await assert_subject_visible(
            db_session,
            subject_type=SubjectType.PRECINCT_EVENT,
            subject_id=uuid.uuid4(),
            organization_id=owner_org_id,
        )
