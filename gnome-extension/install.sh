#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="amelia-widget@amelia.local"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing Amelia GNOME Shell extension…"
mkdir -p "$EXT_DIR"
cp "$ROOT/extension.js" "$ROOT/amelia-indicator.js" "$ROOT/api.js" "$ROOT/stylesheet.css" "$ROOT/metadata.json" "$EXT_DIR/"

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" 2>/dev/null || true
  echo ""
  echo "Extension installed to: $EXT_DIR"
  echo "Enabled via: gnome-extensions enable $UUID"
else
  echo ""
  echo "Extension copied to: $EXT_DIR"
  echo "Install gnome-shell-extension-prefs or use Extensions app to enable Amelia."
fi

echo ""
echo "Restart GNOME Shell to load the extension:"
echo "  • X11 session: Alt+F2 → type 'r' → Enter"
echo "  • Wayland: log out and back in (or reboot)"
echo ""
echo "Ensure the backend is running:"
echo "  systemctl --user status amelia-widget"
