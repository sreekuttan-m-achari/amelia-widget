import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  getDefaultSdkStateRoot,
} from "@cursor/sdk";

import { agentCwd } from "./persona.js";
import { loadPersistedAgentId, persistAgentId } from "./session.js";

export type AmeliaAgent = Awaited<ReturnType<typeof Agent.create>>;

let resumed = false;

export function wasAgentResumed(): boolean {
  return resumed;
}

async function sqliteAvailable(): Promise<boolean> {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

async function localOptions(cwd: string) {
  if (await sqliteAvailable()) {
    return { cwd };
  }

  const storeDir =
    process.env.AMELIA_AGENT_STORE_DIR?.trim() ||
    join(getDefaultSdkStateRoot(cwd), "jsonl");
  mkdirSync(storeDir, { recursive: true });
  console.error(
    `[amelia-agent] Node ${process.version} has no node:sqlite — using JSONL store at ${storeDir}`,
  );

  return {
    cwd,
    store: new JsonlLocalAgentStore(storeDir),
  };
}

export async function createAgent(): Promise<AmeliaAgent> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required (copy server/.env-sample to server/.env)",
    );
  }

  const cwd = agentCwd();
  const local = await localOptions(cwd);
  const model = { id: "composer-2" as const };
  const persistedId = loadPersistedAgentId(cwd);

  try {
    if (persistedId) {
      try {
        const agent = await Agent.resume(persistedId, { apiKey, local, model });
        resumed = true;
        console.error(`[amelia-agent] Resumed session ${agent.agentId}`);
        return agent;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[amelia-agent] Could not resume ${persistedId} (${msg}); creating new session`,
        );
      }
    }

    const agent = await Agent.create({
      apiKey,
      model,
      local,
    });
    resumed = false;
    persistAgentId(cwd, agent.agentId);
    console.error(`[amelia-agent] New session ${agent.agentId}`);
    return agent;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`agent startup failed: ${err.message}`);
    }
    throw err;
  }
}
