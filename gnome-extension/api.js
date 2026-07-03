import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const DEFAULT_API = 'http://127.0.0.1:8787';
const DEFAULT_SERVICE = 'amelia-widget.service';

function apiBase() {
    const fromEnv = GLib.getenv('AMELIA_API_URL');
    if (fromEnv && fromEnv.trim().length > 0)
        return fromEnv.trim().replace(/\/$/, '');
    return DEFAULT_API;
}

function wsUrl() {
    const base = apiBase();
    if (base.startsWith('https://'))
        return `wss://${base.slice('https://'.length)}`;
    if (base.startsWith('http://'))
        return `ws://${base.slice('http://'.length)}`;
    return 'ws://127.0.0.1:8787';
}

function systemdService() {
    const fromEnv = GLib.getenv('AMELIA_SYSTEMD_SERVICE');
    if (fromEnv && fromEnv.trim().length > 0)
        return fromEnv.trim();
    return DEFAULT_SERVICE;
}

function decodeBytes(bytes) {
    if (!bytes)
        return '';
    return new TextDecoder('utf-8').decode(bytes.get_data());
}

function jsonRequest(method, path, bodyObj, callback) {
    const session = new Soup.Session();
    const url = `${apiBase()}${path}`;
    const message = Soup.Message.new(method, url);

    if (bodyObj !== null) {
        const body = JSON.stringify(bodyObj);
        const bytes = new GLib.Bytes(body);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', bytes);
    }

    session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
        (sess, result) => {
            try {
                const bytes = sess.send_and_read_finish(result);
                const status = message.get_status();
                if (status < 200 || status >= 300) {
                    callback(new Error(`HTTP ${status}`), null);
                    return;
                }
                const text = decodeBytes(bytes);
                callback(null, text ? JSON.parse(text) : {});
            } catch (err) {
                callback(err, null);
            }
        },
    );
}

export function fetchHealth(callback) {
    jsonRequest('GET', '/health', null, callback);
}

export function postChat(message, id, callback) {
    jsonRequest('POST', '/chat', { message, id }, callback);
}

export function postCancel(id, callback) {
    jsonRequest('POST', '/chat/cancel', { id }, callback);
}

export function startServerViaSystemd() {
    const service = systemdService();
    try {
        GLib.spawn_command_line_async(`systemctl --user start ${service}`);
    } catch (err) {
        logError(err, 'Amelia: failed to start systemd service');
    }
}

export function connectWebSocket(handlers) {
    const session = new Soup.Session();
    const message = Soup.Message.new('GET', wsUrl());

    session.websocket_connect_async(
        message,
        null,
        null,
        null,
        GLib.PRIORITY_DEFAULT,
        null,
        (sess, result) => {
            try {
                const ws = sess.websocket_connect_finish(result);
                ws.connect('message', (_conn, type, data) => {
                    if (type !== Soup.WebsocketDataType.TEXT)
                        return;
                    try {
                        const payload = JSON.parse(decodeBytes(data));
                        handlers.onMessage?.(payload);
                    } catch (err) {
                        logError(err, 'Amelia: invalid WS JSON');
                    }
                });
                ws.connect('closed', () => handlers.onClose?.());
                handlers.onOpen?.(ws);
            } catch (err) {
                handlers.onError?.(err);
            }
        },
    );
}

export function wsSend(ws, obj) {
    if (!ws)
        return;
    const body = JSON.stringify(obj);
    ws.send(
        null,
        Soup.WebsocketDataType.TEXT,
        new GLib.Bytes(body),
    );
}

export { apiBase, wsUrl };
