import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CursorAgentError } from "@cursor/sdk";

import type { AmeliaAgent } from "./agent.js";
import { createStreamingCollector } from "./stream.js";

const DEFAULT_CANDIDATES = ["SOUL.md", "PROFILE.md"] as const;

function absoluteOrCwd(cwd: string, p: string): string {
  return resolve(cwd, p);
}

export function resolvePersonaFilePath(cwd: string): string | undefined {
  const override = process.env.AGENT_SOUL_PATH?.trim();
  if (override) {
    const p = absoluteOrCwd(cwd, override);
    return existsSync(p) ? p : undefined;
  }
  for (const name of DEFAULT_CANDIDATES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function loadPersonaMarkdown(cwd: string): string | undefined {
  const path = resolvePersonaFilePath(cwd);
  if (!path) return undefined;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function resolveUserFilePath(cwd: string): string | undefined {
  const override = process.env.AGENT_USER_PATH?.trim();
  if (override) {
    const p = absoluteOrCwd(cwd, override);
    return existsSync(p) ? p : undefined;
  }
  const p = resolve(cwd, "USER.md");
  return existsSync(p) ? p : undefined;
}

export function loadUserMarkdown(cwd: string): string | undefined {
  const path = resolveUserFilePath(cwd);
  if (!path) return undefined;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function buildBootstrapUserMessage(
  persona: string,
  userContext?: string,
): string {
  const parts = [
    "The following block is your standing persona and operating instructions for this entire session.",
    "Internalize it; do not repeat it back verbatim unless the user asks.",
    "Then greet the user warmly in 2–3 short sentences (no tools).",
    "",
    "---",
    "",
    persona,
  ];
  if (userContext?.trim()) {
    parts.push(
      "",
      "---",
      "",
      "## User context (from USER.md)",
      "",
      userContext.trim(),
    );
  }
  return parts.join("\n");
}

export function buildGreetingPrompt(userContext?: string): string {
  const parts = [
    "The user just opened the Amelia desktop widget.",
    "Send a brief, warm greeting in 2–3 short sentences.",
    "Introduce yourself as Amelia if it fits your persona.",
    "No tools. Do not mention APIs, WebSockets, or technical checks.",
  ];
  if (userContext?.trim()) {
    parts.push(
      "",
      "## User context",
      "",
      userContext.trim(),
    );
  }
  return parts.join("\n");
}

export function agentCwd(): string {
  return process.env.AMELIA_AGENT_CWD?.trim() || process.cwd();
}

/** Persona warm-up turn; returns the greeting text when successful. */
export async function bootstrapPersonaIfPresent(
  agent: AmeliaAgent,
  cwd: string = agentCwd(),
): Promise<string | undefined> {
  const soulOverride = process.env.AGENT_SOUL_PATH?.trim();
  const userOverride = process.env.AGENT_USER_PATH?.trim();
  const path = resolvePersonaFilePath(cwd);
  const persona = loadPersonaMarkdown(cwd);
  const userPath = resolveUserFilePath(cwd);
  const userContext = loadUserMarkdown(cwd);

  if (soulOverride && !path) {
    console.error(
      `[persona] AGENT_SOUL_PATH is set (${soulOverride}) but file not found.`,
    );
    return undefined;
  }
  if (userOverride && !userPath) {
    console.error(
      `[persona] AGENT_USER_PATH is set (${userOverride}) but file not found.`,
    );
  }
  if (!persona || !path) return undefined;

  console.error(`[persona] Loading ${path}…`);
  if (userPath && userContext) {
    console.error(`[persona] Loading ${userPath}…`);
  }

  const collector = createStreamingCollector();

  try {
    const run = await agent.send(
      buildBootstrapUserMessage(persona, userContext),
    );
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    if (result.status === "error") {
      console.error("[persona] Warm-up ended with error; continuing.");
      return undefined;
    }
    const greeting = collector.getText().trim();
    console.error("[persona] Ready.");
    return greeting || undefined;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error("[persona] Warm-up failed:", err.message);
      return undefined;
    }
    throw err;
  }
}

export function personaStatus(cwd: string = agentCwd()): {
  soulPath?: string;
  userPath?: string;
} {
  return {
    soulPath: resolvePersonaFilePath(cwd),
    userPath: resolveUserFilePath(cwd),
  };
}
