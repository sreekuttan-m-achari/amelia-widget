import type { AmeliaAgent } from "./agent.js";
import { wasAgentResumed } from "./agent.js";
import {
  agentCwd,
  bootstrapPersonaIfPresent,
  buildGreetingPrompt,
  loadUserMarkdown,
} from "./persona.js";
import { runChatTurn } from "./stream.js";

let warmupPromise: Promise<string> | undefined;
let greetingText: string | undefined;
let warm = false;

const greetingListeners = new Set<(greeting: string) => void>();

function emitGreeting(greeting: string): void {
  greetingText = greeting;
  warm = true;
  for (const listener of greetingListeners) {
    listener(greeting);
  }
}

export function onGreetingReady(listener: (greeting: string) => void): () => void {
  greetingListeners.add(listener);
  if (greetingText) {
    listener(greetingText);
  }
  return () => greetingListeners.delete(listener);
}

export function getGreeting(): string | undefined {
  return greetingText;
}

export function isWarm(): boolean {
  return warm;
}

export function startWarmup(agent: AmeliaAgent): Promise<string> {
  if (!warmupPromise) {
    warmupPromise = runWarmup(agent);
  }
  return warmupPromise;
}

export async function waitForWarmup(): Promise<void> {
  if (warmupPromise) {
    await warmupPromise;
  }
}

async function runWarmup(agent: AmeliaAgent): Promise<string> {
  const cwd = agentCwd();
  let greeting: string | undefined;

  try {
    if (!wasAgentResumed()) {
      greeting = await bootstrapPersonaIfPresent(agent, cwd);
    } else {
      console.error("[warmup] Resumed existing session — skipping persona bootstrap");
    }

    if (!greeting?.trim()) {
      const userContext = loadUserMarkdown(cwd);
      greeting = await runChatTurn(agent, buildGreetingPrompt(userContext));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[warmup] Failed:", msg);
  }

  const text = greeting?.trim() || "Hi — I'm Amelia. How can I help?";
  emitGreeting(text);
  console.error(`[warmup] Ready — greeting: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
  return text;
}
