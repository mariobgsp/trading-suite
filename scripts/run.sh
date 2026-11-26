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

echo "▶ Serving static frontend on http://localhost:5173 ..."
# The Python backend's CORS allowlist already covers :5173, so the static
# server's origin works without touching backend/app/config.py.
(cd "$ROOT/frontend-native" && python3 -m http.server 5173 --bind 127.0.0.1)

wait "$BACKEND_PID"
