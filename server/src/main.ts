import "dotenv/config";

import { createAgent } from "./agent.js";
import { cancelStaleRuns } from "./agent-busy.js";
import { agentCwd } from "./persona.js";
import { logDebugStartup } from "./debug.js";
import { startServer } from "./ws.js";
import { startWarmup } from "./warmup.js";

logDebugStartup();

const agent = await createAgent();
const cleared = await cancelStaleRuns(agent.agentId, agentCwd());
if (cleared > 0) {
  console.error(`[amelia-agent] Cleared ${cleared} stale run(s) from prior session`);
}
startWarmup(agent);

try {
  await startServer(agent);
} finally {
  await agent[Symbol.asyncDispose]();
}
