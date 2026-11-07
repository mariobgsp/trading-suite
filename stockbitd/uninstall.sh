#!/usr/bin/env bash
# Remove stockbitd. Keeps the saved session unless --purge is passed.
set -euo pipefail

BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
PURGE=0
for argument in "$@"; do
  case "$argument" in
    --purge) PURGE=1 ;;
    --help|-h)
      echo "usage: $0 [--purge]"
      exit 0
      ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now stockbitd >/dev/null 2>&1 || true
fi
rm -f "$CONFIG_HOME/systemd/user/stockbitd.service"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
rm -f "$BIN_DIR/stockbitd"
rm -f "$HOME/.local/share/applications/stockbitd.desktop"
rm -f "$DATA_HOME/icons/hicolor/scalable/apps/stockbitd.svg"

if [ "$PURGE" = "1" ]; then
  SESSION_DIR="${STOCKBITD_HOME:-$DATA_HOME/stockbitd}"
  case "$SESSION_DIR" in
    "$HOME"/*) rm -rf "$SESSION_DIR"; echo "removed $SESSION_DIR" ;;
    *) echo "refusing to remove $SESSION_DIR (outside HOME)" >&2; exit 1 ;;
  esac
else
  echo "kept the saved session; pass --purge to remove it"
fi

echo "stockbitd removed."
