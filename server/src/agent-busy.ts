import {
  Agent,
  AgentBusyError,
  CursorAgentError,
} from "@cursor/sdk";

import { agentCwd } from "./persona.js";

function busyRetryDelayMs(): number {
  return Math.max(
    400,
    Number.parseInt(process.env.CURSOR_AGENT_BUSY_RETRY_MS?.trim() ?? "800", 10) ||
      800,
  );
}

function busyMaxAttempts(): number {
  return Math.max(
    1,
    Number.parseInt(process.env.CURSOR_AGENT_BUSY_MAX_ATTEMPTS?.trim() ?? "4", 10) ||
      4,
  );
}

export function isAgentBusyError(err: unknown): boolean {
  return (
    err instanceof AgentBusyError ||
    (err instanceof CursorAgentError &&
      err.message.toLowerCase().includes("already has active run"))
  );
}

function runOptions(agentId: string, cwd: string, apiKey?: string) {
  if (agentId.startsWith("bc-")) {
    return {
      list: { runtime: "cloud" as const, apiKey },
      run: { runtime: "cloud" as const, agentId, apiKey },
    };
  }
  return {
    list: { runtime: "local" as const, cwd },
    run: { runtime: "local" as const, cwd },
  };
}

export async function cancelStaleRuns(
  agentId: string,
  cwd = agentCwd(),
  apiKey = process.env.CURSOR_API_KEY?.trim(),
): Promise<number> {
  const opts = runOptions(agentId, cwd, apiKey);
  let cancelled = 0;

  try {
    const { items } = await Agent.listRuns(agentId, opts.list);
    for (const run of items) {
      if (run.status !== "running") {
        continue;
      }
      console.error(`[amelia-agent] Cancelling stale run ${run.id}`);
      await Agent.cancelRun(run.id, opts.run);
      try {
        await run.wait();
      } catch {
        // Run may already be terminal after cancel.
      }
      cancelled++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[amelia-agent] Could not list/cancel stale runs: ${msg}`);
  }

  return cancelled;
}

export async function recoverFromBusyAgent(
  agentId: string,
  cwd = agentCwd(),
  apiKey = process.env.CURSOR_API_KEY?.trim(),
): Promise<boolean> {
  const cancelled = await cancelStaleRuns(agentId, cwd, apiKey);
  if (cancelled > 0) {
    return true;
  }

  if (agentId.startsWith("bc-")) {
    try {
      const info = await Agent.get(agentId, { apiKey });
      if (info.status === "running") {
        console.error(
          `[amelia-agent] Cloud agent ${agentId} still marked running; waiting…`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, busyRetryDelayMs()));
        return true;
      }
    } catch {
      // Fall through to retry delay.
    }
  }

  // No cancellable run found — likely a ghost lock. Brief wait then retry;
  // callers should reset the session if busy persists after maxAttempts.
  console.error(
    `[amelia-agent] No running run listed for ${agentId}; waiting before retry`,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, busyRetryDelayMs()));
  return false;
}

export async function withAgentBusyRecovery<T>(
  agentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = busyMaxAttempts();
  const cwd = agentCwd();
  const apiKey = process.env.CURSOR_API_KEY?.trim();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isAgentBusyError(err) || attempt >= maxAttempts) {
        throw err;
      }
      console.error(
        `[amelia-agent] Session busy (attempt ${attempt}/${maxAttempts}); recovering…`,
      );
      await recoverFromBusyAgent(agentId, cwd, apiKey);
    }
  }

  throw new Error("agent busy after recovery attempts");
}
