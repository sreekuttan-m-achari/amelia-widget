import WebSocket from "ws";

const DEFAULT_API = "http://127.0.0.1:8787";

export type HealthResponse = {
  ok: boolean;
  version?: string;
  warm?: boolean;
  greeting?: string;
  persona?: boolean;
  userProfile?: boolean;
  sessionId?: string;
  mcp?: { loaded: boolean; servers: string[] };
};

export type ServerEvent =
  | { type: "ready"; greeting?: string; warm?: boolean; sessionId?: string }
  | { type: "greeting"; text: string }
  | { type: "pong" }
  | { type: "chunk"; id: string; text: string }
  | { type: "done"; id: string; reply: string }
  | { type: "cancelled"; id: string; reply?: string }
  | { type: "error"; id?: string; error: string };

export function apiBase(): string {
  const fromEnv = process.env.AMELIA_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const host = process.env.AMELIA_WS_HOST?.trim() || "127.0.0.1";
  const rawPort = process.env.AMELIA_WS_PORT?.trim() || "8787";
  const port = Number.parseInt(rawPort, 10);
  const safePort =
    Number.isFinite(port) && port > 0 && port < 65536 ? port : 8787;
  return `http://${host}:${safePort}`;
}

export function wsUrl(): string {
  const base = apiBase();
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}`;
  }
  return "ws://127.0.0.1:8787";
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${apiBase()}/health`);
  if (!res.ok) {
    throw new Error(`health check failed: HTTP ${res.status}`);
  }
  return readJson<HealthResponse>(res);
}

export async function postChat(
  message: string,
  id: string,
): Promise<{ reply?: string; cancelled?: boolean; error?: string }> {
  const res = await fetch(`${apiBase()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, id }),
  });
  const body = await readJson<{
    reply?: string;
    cancelled?: boolean;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? `chat failed: HTTP ${res.status}`);
  }
  return body;
}

export async function postCancel(
  id: string,
): Promise<{ ok?: boolean; cancelled?: boolean }> {
  const res = await fetch(`${apiBase()}/chat/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await readJson<{ ok?: boolean; cancelled?: boolean; error?: string }>(
    res,
  );
  if (!res.ok) {
    throw new Error(body.error ?? `cancel failed: HTTP ${res.status}`);
  }
  return body;
}

export type StreamHandlers = {
  onChunk?: (text: string) => void;
  onDone?: (reply: string) => void;
  onCancelled?: (reply?: string) => void;
  onError?: (error: string) => void;
};

/** Stream a chat turn over SSE. Returns the final reply text. */
export async function streamChat(
  message: string,
  id: string,
  handlers: StreamHandlers = {},
): Promise<string> {
  const res = await fetch(`${apiBase()}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, id }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    let err = `stream failed: HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) err = parsed.error;
    } catch {
      /* ignore */
    }
    throw new Error(err);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalReply = "";

  const handleEvent = (event: ServerEvent): void => {
    if (event.type === "chunk") {
      handlers.onChunk?.(event.text);
    } else if (event.type === "done") {
      finalReply = event.reply;
      handlers.onDone?.(event.reply);
    } else if (event.type === "cancelled") {
      finalReply = event.reply ?? "";
      handlers.onCancelled?.(event.reply);
    } else if (event.type === "error") {
      handlers.onError?.(event.error);
      throw new Error(event.error);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        handleEvent(JSON.parse(payload) as ServerEvent);
      }
      split = buffer.indexOf("\n\n");
    }
  }

  return finalReply;
}

export type WsHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onEvent?: (event: ServerEvent) => void;
  onError?: (error: Error) => void;
};

export function connectWebSocket(handlers: WsHandlers): WebSocket {
  const ws = new WebSocket(wsUrl());

  ws.on("open", () => handlers.onOpen?.());
  ws.on("close", () => handlers.onClose?.());
  ws.on("error", (err) => handlers.onError?.(err));
  ws.on("message", (raw) => {
    try {
      handlers.onEvent?.(JSON.parse(String(raw)) as ServerEvent);
    } catch {
      handlers.onEvent?.({ type: "error", error: "invalid JSON from server" });
    }
  });

  return ws;
}

export function wsSend(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function nextChatId(prefix = "cli"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
