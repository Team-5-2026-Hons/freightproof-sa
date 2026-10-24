"""Builds the real FastAPI app in a fresh interpreter and writes what B1 and B2 snapshot.

Run as:  python -m tests.baseline._app_probe <output.json>   (cwd = backend/)

Why a subprocess: app/main.py decides at IMPORT time which routers exist (the dev panel
is only registered when DEV_PANEL_ENABLED is true). The test process has already imported
the app under whatever the developer's .env says, so an in-process snapshot would differ
between machines. A child process with the relevant settings pinned in its environment
(environment variables beat .env in pydantic-settings) is the same on every machine.
"""

import json
import sys
from typing import Any

from fastapi.routing import APIRoute
from starlette.routing import BaseRoute

from app.core.limits import RateLimit
from app.main import app

# Not a security dependency: every DB endpoint has it, so it carries no signal.
_IGNORED_DEPENDENCIES = frozenset({"app.db.session.get_db"})
_DISPATCHER_DEPENDENCY = "app.auth.dependencies.get_current_dispatcher"
_ADMIN_DEPENDENCY = "app.auth.dependencies.require_admin_dispatcher"
_DRIVER_DEPENDENCY = "app.auth.dependencies.get_current_driver"
# A route that only declares the bearer scheme and calls get_current_dispatcher /
# get_current_driver itself inside the handler (manifest.py: "dispatcher OR driver", which
# Depends() cannot express). Classed apart so it is not mistaken for an open route.
_BEARER_SCHEME = "fastapi.security.http.HTTPBearer"

# The receiver has no account. Their only credential is the capability token in the URL
# (and a cookie after OTP), checked inside the handler rather than by a Depends(), so
# the dependency walk cannot see it. Anything under this prefix is classed by path.
_RECEIVER_PATH_PREFIX = "/api/v1/handover/"

_NON_METHODS = frozenset({"HEAD", "OPTIONS"})


def _dependency_name(call: Any) -> str:
    """module.qualname, except rate-limit closures, which all share one qualname."""
    if getattr(call, "__closure__", None):
        for cell in call.__closure__:
            if isinstance(cell.cell_contents, RateLimit):
                return f"rate_limit:{cell.cell_contents.name}"
    if not hasattr(call, "__qualname__"):
        # A callable instance, e.g. fastapi.security.HTTPBearer(): name its class.
        return f"{type(call).__module__}.{type(call).__qualname__}"
    return f"{call.__module__}.{call.__qualname__}"


def _collect_dependencies(dependant: Any, found: set[str]) -> None:
    for sub in dependant.dependencies:
        if sub.call is not None:
            found.add(_dependency_name(sub.call))
        _collect_dependencies(sub, found)


def _access_class(path: str, dependencies: set[str]) -> str:
    if _ADMIN_DEPENDENCY in dependencies:
        return "admin-dispatcher"
    if _DISPATCHER_DEPENDENCY in dependencies:
        return "dispatcher"
    if _DRIVER_DEPENDENCY in dependencies:
        return "driver"
    if _BEARER_SCHEME in dependencies:
        return "bearer-checked-in-handler"
    if path.startswith(_RECEIVER_PATH_PREFIX):
        return "receiver-capability-token"
    return "none"


def build_auth_map() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    routes: list[BaseRoute] = list(app.routes)
    for route in routes:
        if isinstance(route, APIRoute):
            found: set[str] = set()
            _collect_dependencies(route.dependant, found)
            found -= _IGNORED_DEPENDENCIES
            entry = {"access": _access_class(route.path, found), "dependencies": sorted(found)}
            for method in sorted(route.methods - _NON_METHODS):
                result[f"{method} {route.path}"] = entry
        else:
            # Docs and static routes: no Depends() at all by construction.
            path = getattr(route, "path", repr(route))
            for method in sorted(getattr(route, "methods", None) or {"GET"}):
                if method not in _NON_METHODS:
                    result[f"{method} {path}"] = {"access": "none", "dependencies": []}
    return result


def main() -> None:
    output_path = sys.argv[1]
    payload = {"openapi": app.openapi(), "auth_map": build_auth_map()}
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


if __name__ == "__main__":
    main()
