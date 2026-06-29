import http, { type IncomingMessage } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import type { AmeliaAgent } from "./agent.js";
import { handleChatTurn } from "./chat.js";
import { personaStatus } from "./persona.js";
import { getGreeting, isWarm, onGreetingReady } from "./warmup.js";

type Inbound =
  | { type: "chat"; id?: string; message?: string }
  | { type: "ping" };

type Outbound =
  | { type: "ready"; greeting?: string; warm?: boolean; sessionId?: string }
  | { type: "greeting"; text: string }
  | { type: "pong" }
  | { type: "chunk"; id: string; text: string }
  | { type: "done"; id: string; reply: string }
  | { type: "error"; id?: string; error: string };

function wsHost(): string {
  return process.env.AMELIA_WS_HOST?.trim() || "127.0.0.1";
}

function wsPort(): number {
  const raw = process.env.AMELIA_WS_PORT?.trim() || "8787";
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : 8787;
}

function send(ws: WebSocket, msg: Outbound): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function createSerialQueue() {
  let chain: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function sseWrite(res: import("node:http").ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function startServer(agent: AmeliaAgent): Promise<void> {
  const host = wsHost();
  const port = wsPort();
  const enqueue = createSerialQueue();

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        const persona = personaStatus();
        const greeting = getGreeting();
        jsonResponse(res, 200, {
          ok: true,
          version: "0.5.0",
          sessionId: agent.agentId,
          warm: isWarm(),
          greeting,
          persona: Boolean(persona.soulPath),
          userProfile: Boolean(persona.userPath),
        });
        return;
      }

      if (req.method === "POST" && req.url === "/chat/stream") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const message = (body as { message?: string }).message?.trim() ?? "";
        const id = (body as { id?: string }).id?.trim() || "stream";
        if (!message) {
          jsonResponse(res, 400, { error: "message is required" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        try {
          const reply = await enqueue(() =>
            handleChatTurn(agent, "http-stream", id, message, (text) => {
              sseWrite(res, { type: "chunk", id, text });
            }),
          );
          sseWrite(res, { type: "done", id, reply });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          sseWrite(res, { type: "error", id, error });
        }
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/chat") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonResponse(res, 400, { error: "invalid JSON body" });
          return;
        }
        const message = (body as { message?: string }).message?.trim() ?? "";
        if (!message) {
          jsonResponse(res, 400, { error: "message is required" });
          return;
        }
        try {
          const reply = await enqueue(() =>
            handleChatTurn(agent, "http", "http", message),
          );
          jsonResponse(res, 200, { reply });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          jsonResponse(res, 500, { error });
        }
        return;
      }

      res.writeHead(404);
      res.end();
    })().catch((err) => {
      console.error("[amelia-server]", err);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: "internal error" });
      }
    });
  });

  const wss = new WebSocketServer({ server: httpServer });

  function sendReady(ws: WebSocket): void {
    send(ws, {
      type: "ready",
      warm: isWarm(),
      greeting: getGreeting(),
      sessionId: agent.agentId,
    });
  }

  onGreetingReady((greeting) => {
    for (const client of wss.clients) {
      send(client, { type: "greeting", text: greeting });
    }
  });

  wss.on("connection", (ws) => {
    sendReady(ws);

    ws.on("message", (raw) => {
      void (async () => {
        let parsed: Inbound;
        try {
          parsed = JSON.parse(String(raw)) as Inbound;
        } catch {
          send(ws, { type: "error", error: "invalid JSON" });
          return;
        }

        if (parsed.type === "ping") {
          send(ws, { type: "pong" });
          return;
        }

        if (parsed.type !== "chat") {
          send(ws, { type: "error", error: "unknown message type" });
          return;
        }

        const id = parsed.id?.trim() || "1";
        const message = parsed.message?.trim() ?? "";
        if (!message) {
          send(ws, { type: "error", id, error: "message is required" });
          return;
        }

        try {
          const reply = await enqueue(() =>
            handleChatTurn(agent, "ws", id, message, (text) => {
              send(ws, { type: "chunk", id, text });
            }),
          );
          send(ws, { type: "done", id, reply });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          send(ws, { type: "error", id, error });
        }
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.error(`[amelia-server] ws://${host}:${port}`);
  console.error(`[amelia-server] GET /health  POST /chat  POST /chat/stream`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      wss.close();
      httpServer.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
