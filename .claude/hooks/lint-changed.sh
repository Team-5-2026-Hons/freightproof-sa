#!/usr/bin/env bash
# PostToolUse hook — lint the single file Claude just edited.
#
# Why: catches lint/format errors the moment they're written so they're fixed
# in the same turn, instead of surfacing later in CI or a fresh session.
# Silent on success (zero token cost on the happy path). On failure it prints
# to stderr and exits 2, which feeds the finding back to Claude to fix.
#
# Never blocks a teammate who lacks the tools: a missing ruff/eslint => exit 0.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# The edited path arrives as JSON on stdin: { "tool_input": { "file_path": ... } }.
FILE="$(python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)"
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.py)
    RUFF="$ROOT/backend/.venv/bin/ruff"
    [ -x "$RUFF" ] || RUFF="$(command -v ruff 2>/dev/null || true)"
    [ -n "$RUFF" ] || exit 0
    if ! OUT="$("$RUFF" check "$FILE" 2>&1)"; then
      echo "ruff found issues in $FILE:" >&2
      echo "$OUT" >&2
      exit 2
    fi
    ;;
  *.ts|*.tsx)
    # Walk up to the package dir (dispatcher / driver-pwa) that owns this file.
    DIR="$(dirname "$FILE")"
    while [ "$DIR" != "/" ] && [ ! -f "$DIR/package.json" ]; do DIR="$(dirname "$DIR")"; done
    ESLINT="$DIR/node_modules/.bin/eslint"
    [ -x "$ESLINT" ] || exit 0
    # Only lint when the package actually has an ESLint config. Without one,
    # eslint 9 errors out — that's a setup problem, not a finding, so skip
    # rather than block the edit.
    HAS_CFG=""
    for c in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
             .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
      [ -f "$DIR/$c" ] && { HAS_CFG=1; break; }
    done
    [ -n "$HAS_CFG" ] || exit 0
    # Run from the package dir so ESLint's flat-config lookup resolves; $FILE is
    # absolute so it's still the file that gets linted.
    if ! OUT="$(cd "$DIR" && "$ESLINT" "$FILE" 2>&1)"; then
      # A config/loader failure is not a lint finding — never block on it.
      case "$OUT" in
        *"couldn't find"*|*"Cannot read config"*|*"Invalid option"*) exit 0 ;;
      esac
      echo "eslint found issues in $FILE:" >&2
      echo "$OUT" >&2
      exit 2
    fi
    ;;
esac
exit 0
