"""The push-token registration body: what the driver app may send."""

import pytest
from pydantic import ValidationError

from app.db.models.driver_push_tokens import PUSH_TOKEN_MAX_LENGTH
from app.db.models.enums import PushPlatform
from app.schemas.push import PushTokenRegistration


def test_push_token_registration_valid_body_parses():
    body = {"token": "  fcm-token-abc  ", "platform": "android"}

    parsed = PushTokenRegistration.model_validate(body)

    assert (parsed.token, parsed.platform) == ("fcm-token-abc", PushPlatform.ANDROID)


@pytest.mark.parametrize("token", ["", "   ", "x" * (PUSH_TOKEN_MAX_LENGTH + 1)])
def test_push_token_registration_bad_token_is_rejected(token: str):
    body = {"token": token, "platform": "ios"}

    with pytest.raises(ValidationError):
        PushTokenRegistration.model_validate(body)


def test_push_token_registration_unknown_platform_is_rejected():
    body = {"token": "abc", "platform": "web"}

    with pytest.raises(ValidationError):
        PushTokenRegistration.model_validate(body)


def test_push_token_registration_extra_field_is_rejected():
    body = {"token": "abc", "platform": "ios", "driver_id": "someone-else"}

    with pytest.raises(ValidationError):
        PushTokenRegistration.model_validate(body)
