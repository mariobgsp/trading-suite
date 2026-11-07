#!/usr/bin/env bash
# Install stockbitd for the current user.
#
#   ./install.sh                 binary + desktop entry + systemd unit (not started)
#   ./install.sh --service       also enable and start the user service
#   BIN_DIR=/somewhere ./install.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
WITH_SERVICE=0
for argument in "$@"; do
  case "$argument" in
    --service) WITH_SERVICE=1 ;;
    --help|-h)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $argument" >&2
      exit 2
      ;;
  esac
done

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to build stockbitd (go 1.23 or newer)." >&2
  exit 1
fi

cd "$ROOT"
mkdir -p bin
echo "building stockbitd…"
go build -trimpath -ldflags "-s -w" -o bin/stockbitd ./cmd/stockbitd

install -d "$BIN_DIR"
install -m 0755 bin/stockbitd "$BIN_DIR/stockbitd"

install -d "$HOME/.local/share/applications" "$DATA_HOME/icons/hicolor/scalable/apps"
install -m 0644 assets/stockbitd.svg "$DATA_HOME/icons/hicolor/scalable/apps/stockbitd.svg"
sed "s|@BIN@|$BIN_DIR/stockbitd|g" assets/stockbitd.desktop.in > "$HOME/.local/share/applications/stockbitd.desktop"
chmod 0644 "$HOME/.local/share/applications/stockbitd.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

install -d "$CONFIG_HOME/systemd/user"
sed "s|@BIN@|$BIN_DIR/stockbitd|g" systemd/stockbitd.service.in > "$CONFIG_HOME/systemd/user/stockbitd.service"
chmod 0644 "$CONFIG_HOME/systemd/user/stockbitd.service"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  # A login window needs the graphical session's variables; import them if we
  # are running inside that session. Harmless when they are already absent.
  systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR >/dev/null 2>&1 || true
  if [ "$WITH_SERVICE" = "1" ]; then
    systemctl --user enable --now stockbitd >/dev/null 2>&1 || {
      echo "could not start the user service; run without --service and use: stockbitd serve --open" >&2
    }
  fi
fi

cat <<'EOF'

stockbitd installed.

  binary       $BIN_DIR/stockbitd
  panel        $BIN_DIR/stockbitd serve --open
  first login  open the panel and press "Connect Stockbit"
  session      $STOCKBITD_HOME/session.json (default ~/.local/share/stockbitd)

The desktop launcher "Stockbit" starts the panel. To keep the session warm in
the background, enable the user service:

  systemctl --user enable --now stockbitd

If the service runs the login window, import the display variables once per
graphical session:

  systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR

EOF
