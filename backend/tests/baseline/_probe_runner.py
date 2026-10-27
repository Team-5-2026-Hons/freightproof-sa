"""Runs tests.baseline._app_probe in a child interpreter with pinned settings (cached)."""

import json
import os
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[2]

PROBE_TIMEOUT_SECONDS = 120

_PINNED_ENV = {"APP_VERSION": "baseline", "ENVIRONMENT": "development"}
_DEV_ON_ENV = {"DEV_PANEL_ENABLED": "true", "PULSE_USE_MOCK": "true"}
_DEV_OFF_ENV = {"DEV_PANEL_ENABLED": "false", "PULSE_USE_MOCK": "false"}


@lru_cache(maxsize=None)
def run_probe(dev_tooling: bool) -> dict[str, Any]:
    """{"openapi": ..., "auth_map": ...} for the app built with dev tooling on or off."""
    env = {**os.environ, **_PINNED_ENV, **(_DEV_ON_ENV if dev_tooling else _DEV_OFF_ENV)}
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "probe.json"
        completed = subprocess.run(
            [sys.executable, "-m", "tests.baseline._app_probe", str(output)],
            cwd=BACKEND_DIR, env=env, capture_output=True, text=True,
            timeout=PROBE_TIMEOUT_SECONDS, check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"app probe failed (dev_tooling={dev_tooling}):\n{completed.stderr[-2000:]}")
        loaded: dict[str, Any] = json.loads(output.read_text(encoding="utf-8"))
        return loaded
