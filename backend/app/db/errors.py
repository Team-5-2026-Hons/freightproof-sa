"""Database availability errors, classified only at a database operation boundary."""

from typing import Literal

from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

DatabaseFailureReason = Literal[
    "pool_timeout", "connect_timeout", "command_timeout", "checkout_timeout",
    "connection_unavailable", "server_capacity", "cleanup_timeout",
]
DatabaseOperation = Literal["connect", "checkout", "command", "rollback", "close"]

DATABASE_UNAVAILABLE_DETAIL = "Database temporarily unavailable."

CONNECTION_EXCEPTION_CLASS = "08"
SERVER_UNAVAILABLE_SQLSTATES = frozenset({
    "57P01",
    "57P02",
    "57P03",
})
TOO_MANY_CONNECTIONS = "53300"
INTERNAL_ERROR = "XX000"
SUPAVISOR_CAPACITY_PREFIXES = ("(EMAXCONN", "(ECHECKOUTTIMEOUT)")


class DatabaseUnavailableError(SQLAlchemyError):
    """A DB availability failure, kept in the SQLAlchemy family for service handlers.

    Its message is safe to expose/log. The original error stays in the exception chain,
    since driver messages and SQL parameters must not be copied into the HTTP response.
    """

    def __init__(self, reason: DatabaseFailureReason, operation: DatabaseOperation) -> None:
        super().__init__(DATABASE_UNAVAILABLE_DETAIL)
        self.reason = reason
        self.operation = operation


def database_unavailable(
    exc: BaseException, operation: DatabaseOperation, *, disconnected: bool = False,
) -> DatabaseUnavailableError | None:
    """Classify a known DB failure; never call this around arbitrary application work.

    In particular, a raw TimeoutError/OSError could belong to a partner service elsewhere.
    Integrity, SQL syntax and authentication/configuration failures keep their own handling.
    """
    if not isinstance(exc, Exception):
        return None
    if isinstance(exc, DatabaseUnavailableError):
        return exc
    if isinstance(exc, PoolTimeoutError):
        return DatabaseUnavailableError("pool_timeout", operation)
    original = exc.orig if isinstance(exc, DBAPIError) else exc
    if isinstance(original, TimeoutError):
        timeout_reasons: dict[DatabaseOperation, DatabaseFailureReason] = {
            "connect": "connect_timeout", "checkout": "checkout_timeout",
        }
        return DatabaseUnavailableError(timeout_reasons.get(operation, "command_timeout"), operation)
    reason = _server_reason(original, operation)
    if reason is not None:
        return DatabaseUnavailableError(reason, operation)
    if disconnected or isinstance(original, OSError):
        return DatabaseUnavailableError("connection_unavailable", operation)
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return DatabaseUnavailableError("connection_unavailable", operation)
    return None


def _server_reason(original: object, operation: DatabaseOperation) -> DatabaseFailureReason | None:
    """Read the server's own SQLSTATE; asyncpg and translated DBAPI errors both carry it."""
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if not isinstance(sqlstate, str):
        return None
    if sqlstate == TOO_MANY_CONNECTIONS:
        return "server_capacity"
    if operation == "connect" and sqlstate == INTERNAL_ERROR and str(original).startswith(SUPAVISOR_CAPACITY_PREFIXES):
        return "server_capacity"
    if sqlstate.startswith(CONNECTION_EXCEPTION_CLASS) or sqlstate in SERVER_UNAVAILABLE_SQLSTATES:
        return "connection_unavailable"
    return None
