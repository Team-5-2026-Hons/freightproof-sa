#!/usr/bin/env bash
# Behaviour tests for lint-changed.sh. These use fake linters so they are fast,
# deterministic, and do not depend on a developer's installed packages.
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lint-changed.sh"
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

mkdir -p "$FIXTURE_ROOT/backend/.venv/bin" "$FIXTURE_ROOT/backend/app"
printf 'x = 1\n' > "$FIXTURE_ROOT/backend/app/example.py"
printf '%s\n' '#!/usr/bin/env bash' 'echo "E999 simulated lint failure" >&2' 'exit 1' \
  > "$FIXTURE_ROOT/backend/.venv/bin/ruff"
chmod +x "$FIXTURE_ROOT/backend/.venv/bin/ruff"

set +e
PYTHON_OUTPUT="$(
  printf '{"tool_input":{"file_path":"%s"}}\n' "$FIXTURE_ROOT/backend/app/example.py" \
    | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$HOOK" 2>&1
)"
PYTHON_STATUS=$?
set -e

if [ "$PYTHON_STATUS" -ne 2 ] || [[ "$PYTHON_OUTPUT" != *"E999 simulated lint failure"* ]]; then
  echo "FAIL: Python lint findings must block the edit and reach Claude." >&2
  exit 1
fi

mkdir -p "$FIXTURE_ROOT/frontend/shared/lib" \
  "$FIXTURE_ROOT/frontend/dispatcher/node_modules/.bin"
printf 'export const value = 1;\n' > "$FIXTURE_ROOT/frontend/shared/lib/example.ts"
printf '{}\n' > "$FIXTURE_ROOT/frontend/dispatcher/package.json"
printf 'export default [];\n' > "$FIXTURE_ROOT/frontend/dispatcher/eslint.config.mjs"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n%s\n" "$PWD" "$1" > "$HOOK_CAPTURE"' \
  > "$FIXTURE_ROOT/frontend/dispatcher/node_modules/.bin/eslint"
chmod +x "$FIXTURE_ROOT/frontend/dispatcher/node_modules/.bin/eslint"

SHARED_CAPTURE="$FIXTURE_ROOT/shared-eslint-call.txt"
printf '{"tool_input":{"file_path":"%s"}}\n' "$FIXTURE_ROOT/frontend/shared/lib/example.ts" \
  | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" HOOK_CAPTURE="$SHARED_CAPTURE" "$HOOK"

if [ ! -f "$SHARED_CAPTURE" ]; then
  echo "FAIL: edits in frontend/shared must be linted by a frontend package." >&2
  exit 1
fi

EXPECTED_CALL="${FIXTURE_ROOT}/frontend/dispatcher
${FIXTURE_ROOT}/frontend/shared/lib/example.ts"
if [ "$(cat "$SHARED_CAPTURE")" != "$EXPECTED_CALL" ]; then
  echo "FAIL: shared TypeScript was linted from the wrong package or with the wrong path." >&2
  exit 1
fi

echo "PASS: lint hook reports Python failures and checks shared TypeScript."
