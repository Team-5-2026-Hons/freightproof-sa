#!/usr/bin/env bash
# Stop hook — when the backend has uncommitted changes, run the fast unit
# suite and surface only a summary.
#
# Why: turns "pytest green" from a claim into a fact, but only when backend
# code actually changed this session — so it's instant and free on Q&A turns.
# Runs unit tests only (no DB needed); integration + full suite stay for CI.
# On red tests it exits 2 to feed the failure back to Claude.
set -uo pipefail

# Guard against an infinite stop loop: if we're already re-running because of a
# previous stop-hook block, don't recurse.
INPUT="$(cat)"
echo "$INPUT" | grep -q '"stop_hook_active": *true' && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$ROOT/backend" 2>/dev/null || exit 0

# Only act if backend code actually changed this session.
git status --porcelain -- . 2>/dev/null | grep -q . || exit 0

PY="$ROOT/backend/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3 2>/dev/null || true)"
[ -n "$PY" ] || exit 0
"$PY" -m pytest --version >/dev/null 2>&1 || exit 0

if ! OUT="$("$PY" -m pytest tests/unit -q --tb=line 2>&1)"; then
  echo "Backend unit tests are RED — fix before claiming done:" >&2
  echo "$OUT" | tail -25 >&2
  exit 2
fi
exit 0
