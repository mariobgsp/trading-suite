#!/usr/bin/env bash
set -euo pipefail

# trading-suite.sh — one-command runner for the lean desk (5 routes)
# Usage:
#   ./trading-suite.sh run        # backend :8000 + frontend :5173 (dev, hot-reload)
#   ./trading-suite.sh dev        # alias for run
#   ./trading-suite.sh build      # production build (vite build + tsc)
#   ./trading-suite.sh start      # production start (vite preview + uvicorn)
#   ./trading-suite.sh stop       # kill dev servers started by run
#   ./trading-suite.sh logs       # tail background logs
#   ./trading-suite.sh verify     # backend tests + frontend typecheck
#   ./trading-suite.sh clean      # remove build + prune cache

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
PID_DIR="/tmp/trading-suite"
mkdir -p "$PID_DIR"

info() { printf "\033[36m[trading-suite]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[warn]\033[0m %s\n" "$*"; }
die()  { printf "\033[31m[error]\033[0m %s\n" "$*"; exit 1; }

FRONTEND="$ROOT/frontend-web"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

ensure_backend_venv() {
  if [[ ! -x "$BACKEND/.venv/bin/python" ]]; then
    die "backend/.venv missing — run: cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  fi
}

ensure_frontend_deps() {
  # The frontend is a Vite app in frontend-web, not the repo root; without this
  # the runner silently starts nothing and reports a port that is not listening.
  if [[ ! -d "$FRONTEND/node_modules" ]]; then
    info "installing frontend dependencies (first run only)..."
    (cd "$FRONTEND" && npm install --silent) || die "npm install failed in $FRONTEND"
  fi
}

cmd_run() {
  ensure_backend_venv
  ensure_frontend_deps
  info "starting backend :8000 and frontend :$FRONTEND_PORT (logs: $PID_DIR)..."
  # backend
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --app-dir "$BACKEND" \
    > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  # frontend
  (cd "$FRONTEND" && nohup npm run dev --silent -- --port "$FRONTEND_PORT" > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid")
  sleep 3
  if kill -0 "$(cat "$PID_DIR/backend.pid")" 2>/dev/null; then info "backend up  → http://localhost:8000  (health /api/health)"; else warn "backend failed — see $PID_DIR/backend.log"; fi
  if kill -0 "$(cat "$PID_DIR/frontend.pid")" 2>/dev/null; then info "frontend up → http://localhost:$FRONTEND_PORT"; else warn "frontend failed — see $PID_DIR/frontend.log"; fi
  # The backend reads the study's universe on the first plan, so give it a moment
  # before claiming the app is ready; otherwise the first page load looks broken.
  info "warming the plan (reads the study's data, a few seconds)..."
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 "http://127.0.0.1:8000/api/plan" >/dev/null 2>&1; then
      info "plan ready → open http://localhost:$FRONTEND_PORT"
      break
    fi
    sleep 1
  done
  info "run 'tail -f $PID_DIR/*.log' or './trading-suite.sh logs' to follow"
  info "run './trading-suite.sh stop' to stop"
}

cmd_stop() {
  for name in backend frontend; do
    if [[ -f "$PID_DIR/$name.pid" ]]; then
      pid=$(cat "$PID_DIR/$name.pid")
      if kill -0 "$pid" 2>/dev/null; then kill "$pid" && info "stopped $name ($pid)"; else warn "$name not running"; fi
      rm -f "$PID_DIR/$name.pid"
    else
      warn "no pid for $name"
    fi
  done
  pkill -f "uvicorn app.main:app" 2>/dev/null && info "killed stray uvicorn" || true
  pkill -f "bin/vite dev" 2>/dev/null && info "killed stray vite" || true
  pkill -f "bin/vite preview" 2>/dev/null && info "killed stray vite preview" || true
}

cmd_logs() {
  tail -f "$PID_DIR"/*.log 2>/dev/null || die "no logs yet — run ./trading-suite.sh run first"
}

cmd_build() {
  ensure_frontend_deps
  info "frontend typecheck + build..."
  (cd "$FRONTEND" && npm run build) || die "frontend build failed"
  info "backend tests..."
  (cd backend && .venv/bin/python -m pytest -q) || die "backend tests failed"
  info "backend typecheck..."
  (cd backend && .venv/bin/pyright --version >/dev/null 2>&1 && .venv/bin/pyright . || warn "pyright not installed — skip")
  info "build ok"
}

cmd_start() {
  ensure_backend_venv
  ensure_frontend_deps
  info "production start — backend :8000 (no reload) + frontend :$FRONTEND_PORT"
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir "$BACKEND" > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  (cd "$FRONTEND" && nohup npm run preview --silent -- --port "$FRONTEND_PORT" > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid")
  info "started — health: http://localhost:8000/api/health"
  info "the plan needs the backend's CORS to allow :$FRONTEND_PORT (it does by default)"
}

cmd_clean() {
  rm -rf "$FRONTEND/dist" "$FRONTEND/node_modules/.vite"
  info "pruned frontend build + vite caches"
  if [[ -f "$BACKEND/data/cache.db" ]]; then
    info "cache at $BACKEND/data/cache.db kept (delete manually to reset)"
  fi
}

# The two checks that decide whether the claims on screen are still true: the
# backend suite (which diffs the rule chain against the study's own code, and
# every cited figure against the study's own documents) and the typecheck.
cmd_verify() {
  ensure_backend_venv
  # The venv is built from requirements.txt, which does not include pytest: say so
  # rather than failing with a bare "No module named pytest".
  if ! "$BACKEND/.venv/bin/python" -c 'import pytest' >/dev/null 2>&1; then
    die "pytest is missing from backend/.venv — run: $BACKEND/.venv/bin/pip install pytest"
  fi
  info "backend tests (rule chain, cited figures, sizing, verdict, refresh)…"
  (cd "$BACKEND" && .venv/bin/python -m pytest tests -q)
  info "frontend typecheck…"
  (cd "$FRONTEND" && npx --no-install tsc --noEmit)
  info "both clean"
}

case "${1:-run}" in
  run|dev)      cmd_run ;;
  stop)         cmd_stop ;;
  logs)         cmd_logs ;;
  build)        cmd_build ;;
  start)        cmd_start ;;
  verify)       cmd_verify ;;
  clean)        cmd_clean ;;
  *) echo "Usage: $0 {run|dev|build|start|stop|logs|verify|clean}"; exit 1 ;;
esac
