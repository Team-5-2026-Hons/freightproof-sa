"""SendGrid client: one plain-text email, accepted (202) or EmailUnavailableError.

respx mocks httpx at the transport layer, so no real network call is made.
"""

import json

import httpx
import pytest
import respx

from app.core.config import settings
from app.core.exceptions import EmailUnavailableError
from app.integrations.sendgrid import send_plain_text_email

_BASE = "https://sendgrid.test"
_SEND_URL = f"{_BASE}/v3/mail/send"


@pytest.fixture
def sendgrid_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SENDGRID_API_KEY", "test-sendgrid-key")
    monkeypatch.setattr(settings, "SENDGRID_FROM_EMAIL", "codes@freightproof.test")
    monkeypatch.setattr(settings, "SENDGRID_API_URL", _BASE)


@respx.mock
async def test_send_plain_text_email_posts_message_with_bearer_key(sendgrid_settings: None) -> None:
    # Arrange
    call = respx.post(_SEND_URL).mock(return_value=httpx.Response(202))

    # Act
    await send_plain_text_email(to_address="jane@santam.example", subject="Code", body="123456")

    # Assert
    request = call.calls.last.request
    assert request.headers["Authorization"] == "Bearer test-sendgrid-key"
    body = json.loads(request.content)
    assert body["personalizations"] == [{"to": [{"email": "jane@santam.example"}]}]
    assert body["from"]["email"] == "codes@freightproof.test"
    assert body["content"] == [{"type": "text/plain", "value": "123456"}]
    assert body["tracking_settings"]["click_tracking"]["enable"] is False


@pytest.mark.parametrize("missing", ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"])
@respx.mock
async def test_send_without_configuration_raises_and_sends_nothing(
    sendgrid_settings: None, monkeypatch: pytest.MonkeyPatch, missing: str,
) -> None:
    # Arrange
    call = respx.post(_SEND_URL).mock(return_value=httpx.Response(202))
    monkeypatch.setattr(settings, missing, "")

    # Act / Assert
    with pytest.raises(EmailUnavailableError):
        await send_plain_text_email(to_address="a@b.co", subject="s", body="b")
    assert not call.called


@pytest.mark.parametrize("status", [200, 400, 401, 403, 500])
@respx.mock
async def test_send_any_status_but_202_raises(sendgrid_settings: None, status: int) -> None:
    # Arrange
    respx.post(_SEND_URL).mock(return_value=httpx.Response(status, json={"errors": [{"message": "nope"}]}))

    # Act / Assert
    with pytest.raises(EmailUnavailableError):
        await send_plain_text_email(to_address="a@b.co", subject="s", body="b")


@respx.mock
async def test_send_unreachable_raises(sendgrid_settings: None) -> None:
    # Arrange
    respx.post(_SEND_URL).mock(side_effect=httpx.ConnectError("down"))

    # Act / Assert
    with pytest.raises(EmailUnavailableError):
        await send_plain_text_email(to_address="a@b.co", subject="s", body="b")
