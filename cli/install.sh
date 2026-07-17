#!/usr/bin/env bash
# Install amelia CLI to ~/.local/bin
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

echo "Installing Amelia CLI dependencies…"
cd "$ROOT"
npm install --no-fund --no-audit

chmod +x "$ROOT/bin/amelia"
install -d "$BIN_DIR"
cat > "$BIN_DIR/amelia" <<EOF
#!/usr/bin/env bash
exec "${ROOT}/bin/amelia" "\$@"
EOF
chmod +x "$BIN_DIR/amelia"

echo ""
echo "Installed: $BIN_DIR/amelia"
echo "CLI root:  $ROOT"
echo ""
echo "Usage:"
echo "  amelia                 # interactive TUI"
echo "  amelia chat \"hello\"    # one-shot"
echo "  amelia health"
echo ""
echo "Ensure backend is running: systemctl --user status amelia-widget"
