"""Whether the dispatcher assistant may answer (spec D7: its own on/off switch).

On only when ASSISTANT_ENABLED is true, the chosen provider's key is set, and the model has a price
(so the shared cap can count it). The provider, model and key are the Analytics chat's settings
(spec D0): one key, one bill. This mirrors `analytics_chat.service.chat_enabled` without its
AI_CHAT_ENABLED switch, so either chat can be off while the other is on. That file is not edited.
"""

import logging

from app.core.config import settings
from app.integrations.ai_chat.pricing import UnknownModelError, price_for

logger = logging.getLogger(__name__)

_PROVIDER_KEYS = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def assistant_enabled() -> bool:
    if not settings.ASSISTANT_ENABLED:
        return False
    setting = _PROVIDER_KEYS.get(settings.AI_CHAT_PROVIDER)
    if setting is None:
        logger.error("AI_CHAT_PROVIDER %r is not gemini or anthropic; the assistant stays off", settings.AI_CHAT_PROVIDER)
        return False
    if not getattr(settings, setting):
        return False
    try:
        price_for(settings.AI_CHAT_MODEL)
    except UnknownModelError:
        logger.error("AI_CHAT_MODEL %r has no price; the assistant stays off", settings.AI_CHAT_MODEL)
        return False
    return True
