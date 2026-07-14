#!/usr/bin/env bash
# Rebuilds the graphify knowledge graph headlessly via `graphify extract` +
# `graphify cluster-only`, using the Gemini API directly for semantic
# extraction (docs/papers/images) and community naming — no Claude Code
# session, no agent host, so this never costs Claude tokens. Only the Gemini
# API usage is billed, via GEMINI_API_KEY/GOOGLE_API_KEY.
# Restricted to dev: only the dev-branch maintainer rebuilds/commits the graph.
#
# Usage: GEMINI_API_KEY=... ./scripts/update-graph.sh
#        (or export GEMINI_API_KEY in your shell profile first)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "dev" ]; then
    echo "Refusing to update the graph: current branch is '$BRANCH', not 'dev'." >&2
    exit 1
fi

if [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${GOOGLE_API_KEY:-}" ]; then
    echo "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set — required for doc/image semantic extraction." >&2
    echo "Export it in your shell profile, or run: GEMINI_API_KEY=... ./scripts/update-graph.sh" >&2
    exit 1
fi

GRAPHIFY_BIN="$REPO_ROOT/backend/.venv/bin/graphify"
if [ ! -x "$GRAPHIFY_BIN" ]; then
    echo "graphify CLI not found at $GRAPHIFY_BIN — install backend deps first (cd backend && pip install -r requirements.txt)." >&2
    exit 1
fi

"$GRAPHIFY_BIN" extract "$REPO_ROOT" --backend gemini
"$GRAPHIFY_BIN" cluster-only "$REPO_ROOT" --backend=gemini
