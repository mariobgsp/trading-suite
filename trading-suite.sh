#!/usr/bin/env bash
set -euo pipefail

# trading-suite.sh — one-command runner for the lean desk (5 routes)
# Usage:
#   ./trading-suite.sh run        # backend :8000 + frontend :3000 (dev, hot-reload)
#   ./trading-suite.sh dev        # alias for run
#   ./trading-suite.sh build      # production build (next build + pyright)
#   ./trading-suite.sh start      # production start (next start + uvicorn)
#   ./trading-suite.sh stop       # kill dev servers started by run
#   ./trading-suite.sh logs       # tail background logs
#   ./trading-suite.sh clean      # remove .next + prune cache

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
PID_DIR="/tmp/trading-suite"
mkdir -p "$PID_DIR"

info() { printf "\033[36m[trading-suite]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[warn]\033[0m %s\n" "$*"; }
die()  { printf "\033[31m[error]\033[0m %s\n" "$*"; exit 1; }

ensure_backend_venv() {
  if [[ ! -x "$BACKEND/.venv/bin/python" ]]; then
    die "backend/.venv missing — run: cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  fi
}

cmd_run() {
  ensure_backend_venv
  info "starting backend :8000 and frontend :3000 (logs: $PID_DIR)..."
  # backend
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --app-dir "$BACKEND" \
    > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  # frontend
  nohup npm run dev --silent > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid"
  sleep 2
  if kill -0 "$(cat "$PID_DIR/backend.pid")" 2>/dev/null; then info "backend up  → http://localhost:8000  (health /api/health)"; else warn "backend failed — see $PID_DIR/backend.log"; fi
  if kill -0 "$(cat "$PID_DIR/frontend.pid")" 2>/dev/null; then info "frontend up → http://localhost:3000"; else warn "frontend failed — see $PID_DIR/frontend.log"; fi
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
  pkill -f "next-server.*3000" 2>/dev/null && info "killed stray next" || true
}

cmd_logs() {
  tail -f "$PID_DIR"/*.log 2>/dev/null || die "no logs yet — run ./trading-suite.sh run first"
}

cmd_build() {
  info "next build..."
  npm run build
  info "feature wiring..."
  node scripts/check-feature-wiring.mjs
  info "backend tests..."
  (cd backend && .venv/bin/python -m pytest -q)
  info "backend typecheck..."
  (cd backend && .venv/bin/pyright --version >/dev/null 2>&1 && .venv/bin/pyright . || warn "pyright not installed — skip")
}

cmd_start() {
  ensure_backend_venv
  info "production start — backend :8000 (no reload) + frontend :3000"
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir "$BACKEND" > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  nohup npm run start --silent > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid"
  info "started — health: http://localhost:8000/api/health"
}

cmd_clean() {
  rm -rf .next pilot/.next
  info "pruned .next caches"
  if [[ -f "$BACKEND/data/cache.db" ]]; then
    info "cache at $BACKEND/data/cache.db kept (delete manually to reset)"
  fi
}

case "${1:-run}" in
  run|dev)      cmd_run ;;
  stop)         cmd_stop ;;
  logs)         cmd_logs ;;
  build)        cmd_build ;;
  start)        cmd_start ;;
  clean)        cmd_clean ;;
  *) echo "Usage: $0 {run|dev|build|start|stop|logs|clean}"; exit 1 ;;
esac
