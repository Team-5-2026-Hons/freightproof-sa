"""Integration tests: blockchain endpoint role gating (FP-115).

Tests that:
  - GET /blockchain/receipts requires admin_dispatcher role (403 for dispatcher)
  - GET /blockchain/receipts is accessible to admin_dispatcher (passes role check)
  - POST /blockchain/verify returns nulled hash fields for normal dispatcher
  - POST /blockchain/verify returns full hash payload for admin_dispatcher
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import DispatcherRole, VerifyStatus
from app.main import app
from app.orchestration.verification_service import VerifyOutcome
from app.schemas.people import UserRead

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_ORG_ID = uuid.UUID("00000000-0000-0000-0002-000000000001")
_USER_ID = uuid.UUID("00000000-0000-0000-0002-000000000002")
_SUBJECT_ID = str(uuid.uuid4())

_EXPECTED_HASH = "abc123expected"
_CURRENT_HASH = "abc123current"


def _make_user(role: DispatcherRole) -> UserRead:
    return UserRead(
        id=_USER_ID,
        organization_id=_ORG_ID,
        email="test@fp.co.za",
        full_name="Test User",
        is_active=True,
        created_at=_NOW,
        updated_at=_NOW,
        role=role,
    )


_DISPATCHER_USER = _make_user(DispatcherRole.DISPATCHER)
_ADMIN_USER = _make_user(DispatcherRole.ADMIN_DISPATCHER)


@pytest.fixture(autouse=True)
def clear_dep_overrides():
    """Ensure dependency overrides are torn down after each test."""
    yield
    app.dependency_overrides.clear()


# ── GET /blockchain/receipts ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_receipts_returns_403_for_dispatcher() -> None:
    """Normal dispatcher is blocked at require_admin_dispatcher — no DB query needed."""
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/blockchain/receipts",
            params={"subject_type": "trip", "subject_id": _SUBJECT_ID},
            headers={"Authorization": "Bearer dummy"},
        )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_receipts_passes_role_check_for_admin() -> None:
    """Admin dispatcher passes the role gate; unknown subject yields 404 from visibility check."""
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER

    # Patch assert_subject_visible to raise SubjectNotVisibleError — avoids needing a DB
    # and confirms the admin passed the role gate before reaching the visibility check.
    with patch(
        "app.api.v1.endpoints.blockchain.assert_subject_visible",
        new_callable=AsyncMock,
        side_effect=SubjectNotVisibleError("trip", _SUBJECT_ID),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts",
                params={"subject_type": "trip", "subject_id": _SUBJECT_ID},
                headers={"Authorization": "Bearer dummy"},
            )

    # 404 confirms the admin passed the role check and reached the visibility check
    assert resp.status_code == 404


# ── POST /blockchain/verify ───────────────────────────────────────────────────


def _fake_outcome_with_hashes() -> VerifyOutcome:
    return VerifyOutcome(
        status=VerifyStatus.DB_MISMATCH,
        expected_hash=_EXPECTED_HASH,
        current_hash=_CURRENT_HASH,
        receipt=None,
    )


@pytest.mark.asyncio
async def test_verify_hides_hashes_for_dispatcher() -> None:
    """Normal dispatcher receives status but expected_hash and current_hash are None."""
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER

    with (
        patch(
            "app.api.v1.endpoints.blockchain.assert_subject_visible",
            new_callable=AsyncMock,
        ),
        patch(
            "app.api.v1.endpoints.blockchain.verify_subject",
            new_callable=AsyncMock,
            return_value=_fake_outcome_with_hashes(),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/blockchain/verify",
                json={"subject_type": "trip", "subject_id": _SUBJECT_ID},
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "db_mismatch"
    assert body["expected_hash"] is None
    assert body["current_hash"] is None
    assert body["receipt"] is None


@pytest.mark.asyncio
async def test_verify_exposes_hashes_for_admin() -> None:
    """Admin dispatcher receives the full payload including expected_hash and current_hash."""
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER

    with (
        patch(
            "app.api.v1.endpoints.blockchain.assert_subject_visible",
            new_callable=AsyncMock,
        ),
        patch(
            "app.api.v1.endpoints.blockchain.verify_subject",
            new_callable=AsyncMock,
            return_value=_fake_outcome_with_hashes(),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/blockchain/verify",
                json={"subject_type": "trip", "subject_id": _SUBJECT_ID},
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "db_mismatch"
    assert body["expected_hash"] == _EXPECTED_HASH
    assert body["current_hash"] == _CURRENT_HASH
