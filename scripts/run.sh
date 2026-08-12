#!/usr/bin/env bash
# One-shot launcher for the trading suite: backend (FastAPI) + frontend (Next.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"

echo "▶ Starting Trading Suite backend on http://localhost:8000 ..."
(cd "$BACKEND" && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

cleanup() {
	echo
	echo "▶ Stopping backend (pid $BACKEND_PID)..."
	kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ Starting Next.js frontend on http://localhost:3000 ..."
if command -v bun >/dev/null 2>&1; then
	echo "▶ Using Bun runtime (bun $(bun --version)) for next dev"
	(cd "$ROOT" && bun run dev)
else
	(cd "$ROOT" && npm run dev)
fi

wait "$BACKEND_PID"
