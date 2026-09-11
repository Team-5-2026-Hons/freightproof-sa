"""Integration tests: blockchain endpoint role gating (FP-115).

Tests that:
  - GET /blockchain/receipts requires admin_dispatcher role (403 for dispatcher)
  - GET /blockchain/receipts is accessible to admin_dispatcher (passes role check)
  - POST /blockchain/verify returns nulled hash fields for normal dispatcher
  - POST /blockchain/verify returns full hash payload for admin_dispatcher
"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_dispatcher
from app.core.exceptions import SubjectNotVisibleError
from app.db.models.enums import (
    BlockchainReceiptType,
    DispatcherRole,
    SubjectType,
    VerifyStatus,
)
from app.main import app
from app.orchestration.verification_service import VerifyOutcome
from app.schemas.people import UserRead

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_ORG_ID = uuid.UUID("00000000-0000-0000-0002-000000000001")
_USER_ID = uuid.UUID("00000000-0000-0000-0002-000000000002")
_SUBJECT_ID = str(uuid.uuid4())

_EXPECTED_HASH = "abc123expected"
_CURRENT_HASH = "abc123current"
_LOOKUP_HASH = "ab" * 32
_LOOKUP_TX_ID = "transaction id with unrestricted syntax !@#$%"


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
        transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
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

    # Patch assert_subject_visible where list_receipts_for_subject actually calls it
    # (anchor_service's own import binding, not the endpoints module's) — avoids needing
    # a DB and confirms the admin passed the role gate before reaching the visibility check.
    with patch(
        "app.blockchain.anchor_service.assert_subject_visible",
        new_callable=AsyncMock,
        side_effect=SubjectNotVisibleError("trip", _SUBJECT_ID),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts",
                params={"subject_type": "trip", "subject_id": _SUBJECT_ID},
                headers={"Authorization": "Bearer dummy"},
            )

    # 404 confirms the admin passed the role check and reached the visibility check
    assert resp.status_code == 404


# ── GET /blockchain/receipts/lookup ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_receipt_lookup_returns_403_for_dispatcher() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _DISPATCHER_USER

    with patch(
        "app.api.v1.endpoints.blockchain.lookup_receipts",
        new_callable=AsyncMock,
    ) as lookup_mock:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params={"data_hash": _LOOKUP_HASH},
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 403
    lookup_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_receipt_lookup_normalizes_hash_and_excludes_payload() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    receipt_id = uuid.uuid4()
    subject_id = uuid.uuid4()
    receipt = SimpleNamespace(
        id=receipt_id,
        subject_type=SubjectType.VEHICLE,
        subject_id=subject_id,
        receipt_type=BlockchainReceiptType.VEHICLE_UPDATED,
        data_hash=_LOOKUP_HASH,
        hedera_topic_id="0.0.123",
        hedera_sequence_number=1,
        hedera_consensus_timestamp=_NOW,
        hedera_tx_id=_LOOKUP_TX_ID,
        created_at=_NOW,
        payload_json={"vehicle_event_id": str(subject_id), "event_type": "vehicle_updated"},
    )

    with patch(
        "app.api.v1.endpoints.blockchain.lookup_receipts",
        new_callable=AsyncMock,
        return_value=[receipt],
    ) as lookup_mock:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params={"data_hash": f"  {_LOOKUP_HASH.upper()}  "},
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["id"] == str(receipt_id)
    assert "payload_json" not in resp.json()[0]
    await_args = lookup_mock.await_args
    assert await_args is not None
    assert await_args.kwargs["data_hash"] == _LOOKUP_HASH
    assert await_args.kwargs["hedera_tx_id"] is None
    assert await_args.kwargs["subject_id"] is None


@pytest.mark.asyncio
async def test_receipt_lookup_returns_401_for_invalid_token() -> None:
    with (
        patch("app.auth.dependencies.settings.DEMO_MODE", False),
        patch(
            "app.api.v1.endpoints.blockchain.lookup_receipts",
            new_callable=AsyncMock,
        ) as lookup_mock,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params={"data_hash": _LOOKUP_HASH},
                headers={"Authorization": "Bearer not-a-jwt"},
            )

    assert resp.status_code == 401
    lookup_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_receipt_lookup_returns_403_without_credentials() -> None:
    with (
        patch("app.auth.dependencies.settings.DEMO_MODE", False),
        patch(
            "app.api.v1.endpoints.blockchain.lookup_receipts",
            new_callable=AsyncMock,
        ) as lookup_mock,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params={"data_hash": _LOOKUP_HASH},
            )

    assert resp.status_code == 403
    lookup_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_receipt_lookup_forwards_trimmed_tx_and_subject_filter() -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER
    subject_id = uuid.uuid4()

    with patch(
        "app.api.v1.endpoints.blockchain.lookup_receipts",
        new_callable=AsyncMock,
        return_value=[],
    ) as lookup_mock:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params={
                    "hedera_tx_id": f"  {_LOOKUP_TX_ID}  ",
                    "subject_id": str(subject_id),
                },
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 200
    assert resp.json() == []
    await_args = lookup_mock.await_args
    assert await_args is not None
    assert await_args.kwargs["data_hash"] is None
    assert await_args.kwargs["hedera_tx_id"] == _LOOKUP_TX_ID
    assert await_args.kwargs["subject_id"] == subject_id


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"data_hash": _LOOKUP_HASH, "hedera_tx_id": _LOOKUP_TX_ID},
        {"data_hash": "malformed"},
    ],
)
@pytest.mark.asyncio
async def test_receipt_lookup_returns_422_for_invalid_query(
    params: dict[str, str],
) -> None:
    app.dependency_overrides[get_current_dispatcher] = lambda: _ADMIN_USER

    with patch(
        "app.api.v1.endpoints.blockchain.lookup_receipts",
        new_callable=AsyncMock,
    ) as lookup_mock:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
        ) as client:
            resp = await client.get(
                "/api/v1/blockchain/receipts/lookup",
                params=params,
                headers={"Authorization": "Bearer dummy"},
            )

    assert resp.status_code == 422
    lookup_mock.assert_not_awaited()


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
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
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
            transport=ASGITransport(app=app), base_url="http://test"  # type: ignore[arg-type]
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
