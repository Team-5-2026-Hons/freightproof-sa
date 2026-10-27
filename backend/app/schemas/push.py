"""Pydantic v2 schemas for registering a driver's push-notification device token."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.db.models.driver_push_tokens import PUSH_TOKEN_MAX_LENGTH
from app.db.models.enums import PushPlatform

PushTokenStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=PUSH_TOKEN_MAX_LENGTH)]


class PushTokenRegistration(BaseModel):
    """What the driver app sends after the OS hands it a token (Capacitor `registration`)."""

    model_config = ConfigDict(extra="forbid")

    token: PushTokenStr
    platform: PushPlatform
