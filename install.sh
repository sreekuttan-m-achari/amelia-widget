#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${PLASMOID_TARGET:-$HOME/.local/share/plasma/plasmoids/org.amelia.widget}"

rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -a "$ROOT/package/." "$TARGET/"

kbuildsycoca5 --noincremental 2>/dev/null || true

echo "Installed Amelia plasmoid to: $TARGET"
echo ""
echo "IMPORTANT: Restart Plasma shell so the widget reloads (old UI stays cached otherwise):"
echo "  killall plasmashell && kstart5 plasmashell &"
echo ""
echo "Then remove the old Amelia widget from the desktop and add it again."
echo "Look for status 'online' or 'checking…' in the widget header after install."
