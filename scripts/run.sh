#!/usr/bin/env bash
# One-shot launcher for the trading suite: backend (FastAPI) + frontend (Next.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

echo "▶ Starting Vite frontend on http://localhost:5173 ..."
# The Python backend's CORS allowlist already covers :5173, so the Vite
# default port works without touching backend/app/config.py.
(cd "$ROOT/frontend-web" && npm run dev)

wait "$BACKEND_PID"
