import type { AmeliaAgent } from "./agent.js";
import { createAgent } from "./agent.js";
import { cancelStaleRuns } from "./agent-busy.js";
import { agentCwd } from "./persona.js";
import { clearPersistedAgentId } from "./session.js";
import { resetWarmup, startWarmup } from "./warmup.js";

let agent: AmeliaAgent | undefined;

export async function initAgent(): Promise<AmeliaAgent> {
  agent = await createAgent();
  return agent;
}

export function getAgent(): AmeliaAgent {
  if (!agent) {
    throw new Error("agent not initialized");
  }
  return agent;
}

export async function resetAgentSession(): Promise<AmeliaAgent> {
  const cwd = agentCwd();
  if (agent) {
    try {
      await agent[Symbol.asyncDispose]();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[amelia-agent] dispose before reset failed: ${msg}`);
    }
  }

  clearPersistedAgentId(cwd);
  resetWarmup();
  agent = await createAgent();
  const cleared = await cancelStaleRuns(agent.agentId, cwd);
  if (cleared > 0) {
    console.error(`[amelia-agent] Cleared ${cleared} stale run(s) after session reset`);
  }
  startWarmup(agent);
  console.error(`[amelia-agent] Reset session → ${agent.agentId}`);
  return agent;
}

export async function shutdownAgent(): Promise<void> {
  if (!agent) {
    return;
  }
  try {
    await agent[Symbol.asyncDispose]();
  } finally {
    agent = undefined;
  }
}
