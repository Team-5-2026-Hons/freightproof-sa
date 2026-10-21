"""Cleanup after an existing failure must not replace the request's primary error."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def rollback_after_error(session: AsyncSession) -> bool:
    """Attempt rollback, preserving the caller's error and incoming cancellation.

    DatabaseSession bounds rollback and discards failed connections. Callers that
    intend to query again must check the result and re-raise their original error
    on failure, rather than continue a recovery path after unsuccessful cleanup.
    """
    try:
        await session.rollback()
    except Exception as cleanup_error:
        logger.warning("Database rollback failed error_type=%s", type(cleanup_error).__name__)
        return False
    return True
