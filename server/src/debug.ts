import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ConversationTransport = "http" | "http-stream" | "ws";

export type ConversationLogEntry = {
  transport: ConversationTransport;
  id: string;
  user: string;
  reply?: string;
  error?: string;
  durationMs?: number;
};

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isDebugEnabled(): boolean {
  return truthyEnv("AMELIA_DEBUG");
}

export function isStreamDebugEnabled(): boolean {
  return isDebugEnabled() && truthyEnv("AMELIA_DEBUG_STREAM");
}

function logFilePath(): string | undefined {
  const override = process.env.AMELIA_DEBUG_LOG?.trim();
  if (override) return resolve(override);
  if (isDebugEnabled()) {
    return resolve(process.cwd(), ".amelia-conversations.ndjson");
  }
  return undefined;
}

function writeLogLine(entry: ConversationLogEntry): void {
  const file = logFilePath();
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
    "utf8",
  );
}

export function logConversation(entry: ConversationLogEntry): void {
  if (!isDebugEnabled()) return;

  const prefix = `[amelia-debug] ${entry.transport} id=${entry.id}`;
  console.error(`${prefix} user: ${entry.user}`);
  if (entry.reply !== undefined) {
    console.error(`${prefix} reply: ${entry.reply}`);
  }
  if (entry.error) {
    console.error(`${prefix} error: ${entry.error}`);
  }
  if (entry.durationMs !== undefined) {
    console.error(`${prefix} durationMs: ${entry.durationMs}`);
  }

  writeLogLine(entry);
}

export function logStreamChunk(id: string, text: string): void {
  if (!isStreamDebugEnabled()) return;
  console.error(`[amelia-debug] ws chunk id=${id}: ${JSON.stringify(text)}`);
}

export function logDebugStartup(): void {
  if (!isDebugEnabled()) return;
  const file = logFilePath();
  console.error("[amelia-debug] conversation logging enabled");
  if (file) {
    console.error(`[amelia-debug] writing to ${file}`);
  }
  if (isStreamDebugEnabled()) {
    console.error("[amelia-debug] stream chunk logging enabled");
  }
}
