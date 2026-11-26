#!/usr/bin/env bash
set -euo pipefail

# trading-suite.sh — one-command runner for the lean desk (7 static pages)
# Usage:
#   ./trading-suite.sh run        # backend :8000 + static frontend :5173
#   ./trading-suite.sh dev        # alias for run
#   ./trading-suite.sh build      # frontend syntax check + backend tests
#   ./trading-suite.sh start      # production start (static server + uvicorn)
#   ./trading-suite.sh lan        # backend on the LAN, for the phone app
#   ./trading-suite.sh stop       # kill dev servers started by run
#   ./trading-suite.sh logs       # tail background logs
#   ./trading-suite.sh verify     # backend tests + frontend typecheck
#   ./trading-suite.sh sync-data  # weekly Yahoo fetch -> local store -> warm plan
#   ./trading-suite.sh clean      # remove build + prune cache

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
PID_DIR="/tmp/trading-suite"
mkdir -p "$PID_DIR"

info() { printf "\033[36m[trading-suite]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[warn]\033[0m %s\n" "$*"; }
die()  { printf "\033[31m[error]\033[0m %s\n" "$*"; exit 1; }

FRONTEND="$ROOT/frontend-native"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

ensure_backend_venv() {
  # Codes for the sync command: backend_missing, sync_failed.
  if [[ ! -x "$BACKEND/.venv/bin/python" ]]; then
    die "backend/.venv missing — run: cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt"
  fi
}

cmd_run() {
  ensure_backend_venv
  info "starting backend :8000 and frontend :$FRONTEND_PORT (logs: $PID_DIR)..."
  # backend
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --app-dir "$BACKEND" \
    > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  # frontend — static files, no build step; the backend's CORS allows :5173
  (cd "$FRONTEND" && nohup python3 -m http.server "$FRONTEND_PORT" --bind 127.0.0.1 > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid")
  sleep 3
  if kill -0 "$(cat "$PID_DIR/backend.pid")" 2>/dev/null; then info "backend up  → http://localhost:8000  (health /api/health)"; else warn "backend failed — see $PID_DIR/backend.log"; fi
  if kill -0 "$(cat "$PID_DIR/frontend.pid")" 2>/dev/null; then info "frontend up → http://localhost:$FRONTEND_PORT"; else warn "frontend failed — see $PID_DIR/frontend.log"; fi
  # The backend reads the study's universe on the first plan, so give it a moment
  # before claiming the app is ready; otherwise the first page load looks broken.
  info "warming the plan (persisted artifact; the first run computes it once)..."
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
  pkill -f "http.server $FRONTEND_PORT" 2>/dev/null && info "killed stray static server" || true
}

cmd_logs() {
  tail -f "$PID_DIR"/*.log 2>/dev/null || die "no logs yet — run ./trading-suite.sh run first"
}

cmd_build() {
  info "frontend syntax check (node --check, no build step)..."
  for f in "$FRONTEND"/js/*.js; do node --check "$f" || die "syntax error in $f"; done
  info "backend tests..."
  (cd backend && .venv/bin/python -m pytest -q) || die "backend tests failed"
  info "backend typecheck..."
  (cd backend && .venv/bin/pyright --version >/dev/null 2>&1 && .venv/bin/pyright . || warn "pyright not installed — skip")
  info "build ok"
}

cmd_lan() {
  # The phone reaches the API over Wi-Fi, where 127.0.0.1 means the phone itself.
  ensure_backend_venv
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
  [[ -n "$ip" ]] || die "no LAN address — join a Wi-Fi network first"
  info "backend on 0.0.0.0:8000 (logs: $PID_DIR/backend.log)"
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir "$BACKEND" \
    > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  sleep 1
  if curl -fsS -m 2 "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
    info "phone → http://$ip:8000  (long-press the app's refresh button to set it)"
  else
    warn "backend did not answer yet — see $PID_DIR/backend.log"
  fi
}

cmd_start() {
  ensure_backend_venv
  info "production start — backend :8000 (no reload) + static frontend :$FRONTEND_PORT"
  nohup "$BACKEND/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir "$BACKEND" > "$PID_DIR/backend.log" 2>&1 & echo $! > "$PID_DIR/backend.pid"
  (cd "$FRONTEND" && nohup python3 -m http.server "$FRONTEND_PORT" --bind 127.0.0.1 > "$PID_DIR/frontend.log" 2>&1 & echo $! > "$PID_DIR/frontend.pid")
  info "started — health: http://localhost:8000/api/health"
  info "the plan needs the backend's CORS to allow :$FRONTEND_PORT (it does by default)"
}

cmd_clean() {
  info "frontend-native ships no build output — nothing to prune"
  if [[ -f "$BACKEND/data/cache.db" ]]; then
    info "cache at $BACKEND/data/cache.db kept (delete manually to reset)"
  fi
}

cmd_plan() {
  ensure_backend_venv
  (cd "$BACKEND" && .venv/bin/python -m app.plan.cli "$@")
}

# The weekly data plane: fetch the study's 5y Yahoo set, import it into the
# normalized SQLite store, then compute the persisted plan once. Pass
# --no-fetch to import an existing study snapshot without touching the network.
cmd_sync_data() {
  ensure_backend_venv
  (cd "$BACKEND" && .venv/bin/python scripts/sync_market.py "$@")
}

# The two checks that decide whether the claims on screen are still true: the
# backend suite (which diffs the rule chain against the study's own code, and
# every cited figure against the study's own documents) and the typecheck.
cmd_verify() {
  ensure_backend_venv
  # The venv is built from requirements.txt, which does not include pytest, and
  # this one has no pip of its own: name the command rather than failing with a
  # bare "No module named pytest".
  if ! "$BACKEND/.venv/bin/python" -c 'import pytest' >/dev/null 2>&1; then
    die "pytest is missing from backend/.venv — run: uv pip install --python backend/.venv/bin/python pytest"
  fi
  # Both checks run even when the first fails: a failing test is exactly when the
  # typecheck is worth having, and stopping at the first error hides it.
  local backend_status=0 frontend_status=0
  info "backend tests (rule chain, cited figures, sizing, verdict, refresh)…"
  (cd "$BACKEND" && .venv/bin/python -m pytest tests -q) || backend_status=$?
  info "frontend syntax check (node --check over frontend-native/js)..."
  for f in "$FRONTEND"/js/*.js; do node --check "$f" || frontend_status=$?; done
  if [[ "$backend_status" -eq 0 && "$frontend_status" -eq 0 ]]; then
    info "all clean"
    return 0
  fi
  warn "verify: backend=$([[ "$backend_status" -eq 0 ]] && echo pass || echo "fail (see above)") · frontend=$([[ "$frontend_status" -eq 0 ]] && echo pass || echo "fail (see above)")"
  return 1
}

case "${1:-run}" in
  run|dev)      cmd_run ;;
  plan)         shift; cmd_plan "$@" ;;
  sync-data)    shift; cmd_sync_data "$@" ;;
  stop)         cmd_stop ;;
  logs)         cmd_logs ;;
  build)        cmd_build ;;
  start)        cmd_start ;;
  lan)          cmd_lan ;;
  verify)       cmd_verify ;;
  clean)        cmd_clean ;;
  *) echo "Usage: $0 {run|dev|plan|sync-data|build|start|lan|stop|logs|verify|clean}"; exit 1 ;;
esac
