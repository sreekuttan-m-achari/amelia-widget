# Amelia widget

KDE Plasma desktop widget + local API server (HTTP + WebSocket streaming).

## Layout

```text
amelia-widget/
  package/          # KDE plasmoid (QML)
  server/           # Node API + Cursor SDK agent
  install.sh        # Install plasmoid
```

## 1. Server setup

**Requires Node.js 22.13+** (`@cursor/sdk`). Use [nvm](https://github.com/nvm-sh/nvm).

```bash
cd server
nvm use
cp .env-sample .env          # set CURSOR_API_KEY
cp SOUL.sample.md SOUL.md    # optional persona
cp USER.sample.md USER.md    # optional user profile
npm install
npm start
```

### Run as a systemd user service (recommended)

```bash
cd server
nvm use
./deploy/install-service.sh
```

```bash
systemctl --user status amelia-widget
journalctl --user -u amelia-widget -f
```

Keep running after logout (optional):

```bash
loginctl enable-linger "$USER"
```

Stop the manual `npm start` terminal if the service is running (same port).

### API

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness + persona flags |
| `POST /chat` | `{"message":"...","id":"..."}` → `{"reply":"..."}` or `{"cancelled":true,"reply":"..."}` |
| `POST /chat/cancel` | `{"id":"..."}` — stop the in-flight turn for that id |
| `POST /chat/stream` | SSE stream: `chunk`, `done`, or `cancelled` events |
| `ws://127.0.0.1:8787` | WebSocket chat with streaming chunks |

### Persona (`SOUL.md`)

On startup the server loads `SOUL.md` (or `PROFILE.md`) and optional `USER.md`, then sends a warm-up turn so Amelia adopts that voice for the session. Override paths with `AGENT_SOUL_PATH` / `AGENT_USER_PATH` in `.env`.

### MCP tools (extensible)

Add capabilities by editing **`server/.cursor/mcp.json`** (same format as Cursor IDE / `cursor-openapi`):

```bash
cd server
cp .cursor/mcp.json.sample .cursor/mcp.json
# edit .cursor/mcp.json — add servers under mcpServers
systemctl --user restart amelia-widget
```

- **`${workspaceFolder}`** resolves to `AMELIA_AGENT_CWD` or `server/` cwd
- **`${env:VAR_NAME}`** reads from `server/.env`
- **`MCP_CONFIG_PATH`** — optional override (relative to agent cwd or absolute)
- Reuse another project’s config, e.g. `MCP_CONFIG_PATH=/path/to/cursor-openapi/.cursor/mcp.json` with `AMELIA_AGENT_CWD` set to that repo if scripts use `${workspaceFolder}`

`GET /health` includes `mcp.servers` when MCP loaded successfully.

### Debug mode

```bash
AMELIA_DEBUG=1
AMELIA_DEBUG_STREAM=1
```

Logs to stderr and `server/.amelia-conversations.ndjson`.

## 2. Plasmoid

```bash
./install.sh
killall plasmashell && kstart5 plasmashell &
```

Remove and re-add the widget. Look for **v0.4** (blue **●** when WebSocket streaming is active).

Uses WebSocket for streaming when available; falls back to HTTP `POST /chat`. While a reply is in progress, **Cancel** stops the agent; **Resume** resends the last message. Click the **fullscreen** icon (or press **Esc** to exit) for immersive focus mode.

## Uninstall

```bash
systemctl --user disable --now amelia-widget
rm -f ~/.config/systemd/user/amelia-widget.service
rm -rf ~/.local/share/plasma/plasmoids/org.amelia.widget
```
