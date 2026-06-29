/**
 * stdio MCP server: Home Assistant **REST** API (same Bearer token as HA MCP).
 * Complements the official HA MCP bridge (tools/entities exposed there may differ).
 *
 * Env (see .env-sample):
 * - HA_API_ACCESS_TOKEN or API_ACCESS_TOKEN (required)
 * - HA_BASE_URL optional, e.g. http://homeassistant.local:8123
 * - If HA_BASE_URL unset, derived from HA_MCP_HTTP_URL by stripping /api/mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

function haBaseUrl() {
  const explicit = process.env.HA_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const mcp = process.env.HA_MCP_HTTP_URL?.trim();
  if (!mcp) {
    throw new Error(
      "Set HA_BASE_URL or HA_MCP_HTTP_URL (e.g. …/api/mcp) so the REST base URL can be derived.",
    );
  }
  const stripped = mcp.replace(/\/api\/mcp\/?$/i, "");
  if (stripped !== mcp) return stripped.replace(/\/$/, "");
  try {
    const u = new URL(mcp);
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    throw new Error(`HA_MCP_HTTP_URL is not a valid URL: ${mcp}`);
  }
}

function haToken() {
  const t =
    process.env.HA_API_ACCESS_TOKEN?.trim() ||
    process.env.API_ACCESS_TOKEN?.trim();
  if (!t) throw new Error("Set HA_API_ACCESS_TOKEN (or API_ACCESS_TOKEN).");
  return t;
}

async function haFetchJson(path) {
  const base = haBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${haToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HA ${res.status} ${path}: ${text.slice(0, 800)}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

function domainOfEntityId(entityId) {
  const i = entityId.indexOf(".");
  return i === -1 ? "unknown" : entityId.slice(0, i);
}

function textResult(obj, maxChars = 120_000) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const truncated = s.length > maxChars ? `${s.slice(0, maxChars)}\n… [truncated]` : s;
  return { content: [{ type: "text", text: truncated }] };
}

async function main() {
  haBaseUrl();
  haToken();

  const server = new McpServer({
    name: "home-assistant-rest",
    version: "1.0.0",
  });

  server.registerTool(
    "ha_rest_domain_summary",
    {
      description:
        "Home Assistant REST: GET /api/states and return entity counts per domain (e.g. esphome, light). Use to see what exists in HA beyond MCP-exposed entities.",
    },
    async () => {
      const states = await haFetchJson("/api/states");
      if (!Array.isArray(states)) {
        return textResult({ error: "Unexpected /api/states shape", sample: states });
      }
      const counts = {};
      for (const s of states) {
        const id = s.entity_id;
        if (typeof id !== "string") continue;
        const d = domainOfEntityId(id);
        counts[d] = (counts[d] ?? 0) + 1;
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => ({ domain, count }));
      return textResult({
        total_entities: states.length,
        by_domain: sorted,
      });
    },
  );

  server.registerTool(
    "ha_rest_search_states",
    {
      description:
        "Home Assistant REST: search /api/states by optional substring (entity_id or friendly_name) and optional domain prefix (e.g. esphome). Returns up to `limit` matches.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Case-insensitive match on entity_id or friendly_name"),
        domain: z
          .string()
          .optional()
          .describe("Entity domain prefix, e.g. esphome, light, sensor"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows (default 50)"),
      },
    },
    async ({ query, domain, limit }) => {
      const states = await haFetchJson("/api/states");
      if (!Array.isArray(states)) {
        return textResult({ error: "Unexpected /api/states shape" });
      }
      const q = query?.trim().toLowerCase();
      const dom = domain?.trim().toLowerCase();
      const max = limit ?? 50;
      const out = [];
      for (const s of states) {
        const id = s.entity_id;
        if (typeof id !== "string") continue;
        if (dom && domainOfEntityId(id) !== dom) continue;
        const name =
          (s.attributes && typeof s.attributes.friendly_name === "string"
            ? s.attributes.friendly_name
            : "") || "";
        if (q) {
          const hay = `${id} ${name}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({
          entity_id: id,
          friendly_name: name || undefined,
          state: s.state,
        });
        if (out.length >= max) break;
      }
      return textResult({
        match_count: out.length,
        truncated: out.length >= max,
        entities: out,
      });
    },
  );

  server.registerTool(
    "ha_rest_get_state",
    {
      description:
        "Home Assistant REST: GET /api/states/{entity_id} for one entity (full state object).",
      inputSchema: {
        entity_id: z
          .string()
          .describe("e.g. light.kitchen or esphome.my_node_sensor"),
      },
    },
    async ({ entity_id }) => {
      const id = entity_id.trim();
      const state = await haFetchJson(`/api/states/${encodeURIComponent(id)}`);
      return textResult(state);
    },
  );

  server.registerTool(
    "ha_rest_get_config",
    {
      description:
        "Home Assistant REST: GET /api/config (core HA config; can be large — response may be truncated).",
    },
    async () => {
      const cfg = await haFetchJson("/api/config");
      return textResult(cfg, 80_000);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
