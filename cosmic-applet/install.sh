#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
APP_DIR="$PREFIX/share/applications"
ICON_DIR="$PREFIX/share/icons/hicolor/scalable/apps"

source "$HOME/.cargo/env" 2>/dev/null || true

echo "Building cosmic-applet-amelia (release)…"
cd "$ROOT"
cargo build --release

install -Dm0755 "$ROOT/target/release/cosmic-applet-amelia" "$BIN_DIR/cosmic-applet-amelia"
install -Dm0644 "$ROOT/resources/com.amelia.CosmicApplet.desktop" "$APP_DIR/com.amelia.CosmicApplet.desktop"
install -Dm0644 "$ROOT/resources/com.amelia.CosmicApplet.svg" "$ICON_DIR/com.amelia.CosmicApplet.svg"

if pgrep -x cosmic-applet-amelia >/dev/null 2>&1; then
  echo "Restarting running cosmic-applet-amelia (COSMIC will respawn it)…"
  pkill -x cosmic-applet-amelia || true
  sleep 0.5
fi

echo ""
echo "Installed COSMIC Amelia applet to:"
echo "  $BIN_DIR/cosmic-applet-amelia"
echo "  $APP_DIR/com.amelia.CosmicApplet.desktop"
echo ""
echo "Add it from COSMIC panel settings → Add applet → Amelia"
echo "If the popup still looks old, close it and click the panel icon again."
echo "Ensure the backend is running: systemctl --user status amelia-widget"
