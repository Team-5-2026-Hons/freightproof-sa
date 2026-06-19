"""Unit tests: Supabase Auth Admin client for dispatcher provisioning (FP-115).

httpx is mocked so no real network calls are made — these verify the request
shape (role claim in app_metadata, email auto-confirm) and the failure mapping.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import DuplicateResourceError
from app.db.models.enums import DispatcherRole
from app.integrations.supabase_admin import create_dispatcher_auth_user


def _mock_async_client(response: MagicMock) -> tuple[MagicMock, MagicMock]:
    """Build a mock for httpx.AsyncClient whose context-managed instance.post returns `response`.

    Returns (async_client_class_mock, client_instance_mock) so tests can assert on the
    outgoing request via client_instance.post.call_args.
    """
    client_instance = MagicMock()
    client_instance.post = AsyncMock(return_value=response)

    async_client = MagicMock()
    async_client.return_value.__aenter__ = AsyncMock(return_value=client_instance)
    async_client.return_value.__aexit__ = AsyncMock(return_value=False)
    return async_client, client_instance


async def test_create_dispatcher_auth_user_returns_uuid_and_sets_role():
    new_id = uuid.uuid4()
    response = MagicMock()
    response.status_code = 200
    response.is_success = True
    response.json.return_value = {"id": str(new_id)}

    async_client, client_instance = _mock_async_client(response)

    with patch("app.integrations.supabase_admin.httpx.AsyncClient", async_client):
        result = await create_dispatcher_auth_user(
            email="admin@operator.example",
            password="s3cret-pw",
            full_name="Admin Dispatcher",
            role=DispatcherRole.ADMIN_DISPATCHER,
        )

    assert result == new_id

    _, kwargs = client_instance.post.call_args
    payload = kwargs["json"]
    assert payload["app_metadata"]["role"] == "admin_dispatcher"
    assert payload["email_confirm"] is True
    assert payload["email"] == "admin@operator.example"


async def test_create_dispatcher_auth_user_duplicate_email_raises():
    response = MagicMock()
    response.status_code = 422
    response.is_success = False
    response.json.return_value = {"msg": "email already registered"}

    async_client, _ = _mock_async_client(response)

    with patch("app.integrations.supabase_admin.httpx.AsyncClient", async_client):
        with pytest.raises(DuplicateResourceError):
            await create_dispatcher_auth_user(
                email="dup@operator.example",
                password="pw",
                full_name="Dup",
                role=DispatcherRole.DISPATCHER,
            )


async def test_create_dispatcher_auth_user_server_error_raises_valueerror():
    response = MagicMock()
    response.status_code = 500
    response.is_success = False
    response.json.return_value = {"message": "internal error"}
    response.text = "internal error"

    async_client, _ = _mock_async_client(response)

    with patch("app.integrations.supabase_admin.httpx.AsyncClient", async_client):
        with pytest.raises(ValueError):
            await create_dispatcher_auth_user(
                email="x@operator.example",
                password="pw",
                full_name="X",
                role=DispatcherRole.DISPATCHER,
            )
