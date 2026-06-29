#!/usr/bin/env bash
# Install amelia-widget server as a systemd user service.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="amelia-widget.service"
TEMPLATE="${SERVER_DIR}/deploy/amelia-widget.service.in"

if [[ ! -f "$SERVER_DIR/.env" ]]; then
  echo "Missing $SERVER_DIR/.env — copy .env-sample and set CURSOR_API_KEY first." >&2
  exit 1
fi

TSX="${SERVER_DIR}/node_modules/.bin/tsx"
if [[ ! -x "$TSX" ]]; then
  echo "Run npm install in $SERVER_DIR first." >&2
  exit 1
fi

# systemd does not load nvm — resolve Node 22 from .nvmrc explicitly.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  cd "$SERVER_DIR"
  nvm install >/dev/null 2>&1 || true
  nvm use >/dev/null
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "node not found. Install Node 22 via nvm in $SERVER_DIR (.nvmrc)." >&2
  exit 1
fi

NODE_VERSION="$("$NODE" -v)"
if [[ "$NODE_VERSION" != v22* ]]; then
  echo "Expected Node 22.x (see server/.nvmrc), got $NODE_VERSION at $NODE" >&2
  echo "Run: cd $SERVER_DIR && nvm install && nvm use" >&2
  exit 1
fi

USER_NAME="$(whoami)"
mkdir -p "$USER_UNIT_DIR"

sed \
  -e "s|__SERVICE_USER__|${USER_NAME}|g" \
  -e "s|__SERVER_DIR__|${SERVER_DIR}|g" \
  -e "s|__NODE__|${NODE}|g" \
  -e "s|__TSX__|${TSX}|g" \
  "$TEMPLATE" > "${USER_UNIT_DIR}/${SERVICE_NAME}"

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}"
systemctl --user reset-failed "${SERVICE_NAME}" 2>/dev/null || true
systemctl --user restart "${SERVICE_NAME}"

echo "Installed ${SERVICE_NAME} using ${NODE} (${NODE_VERSION})"
echo ""
echo "  systemctl --user status ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo ""
echo "Stop any manual 'npm start' on port 8787 before using the service."
echo "To keep running after logout (optional):"
echo "  loginctl enable-linger ${USER_NAME}"
