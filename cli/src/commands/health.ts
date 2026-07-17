import { fetchHealth } from "../api.js";

export async function runHealth(json: boolean): Promise<number> {
  try {
    const health = await fetchHealth();
    if (json) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      const status = health.warm ? "online" : "warming";
      console.log(`Amelia ${status} (${health.version ?? "?"})`);
      if (health.greeting) console.log(health.greeting);
      if (health.mcp?.loaded) {
        console.log(`MCP: ${health.mcp.servers.join(", ")}`);
      }
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ ok: false, error: msg }));
    } else {
      console.error(`Amelia offline: ${msg}`);
    }
    return 1;
  }
}
