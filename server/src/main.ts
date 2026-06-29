import "dotenv/config";

import { createAgent } from "./agent.js";
import { logDebugStartup } from "./debug.js";
import { startServer } from "./ws.js";
import { startWarmup } from "./warmup.js";

logDebugStartup();

const agent = await createAgent();
startWarmup(agent);

try {
  await startServer(agent);
} finally {
  await agent[Symbol.asyncDispose]();
}
