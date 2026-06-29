import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

import type { McpServerConfig } from "@cursor/sdk";

import { agentCwd } from "../persona.js";

let lastLoadedServerNames: string[] = [];

/** Names from the most recent successful MCP config load (for /health). */
export function getMcpServerNames(): string[] {
  return [...lastLoadedServerNames];
}

export function resolveMcpConfigPath(cwd: string = agentCwd()): string {
  const override = process.env.MCP_CONFIG_PATH?.trim();
  if (override) {
    return isAbsolute(override) ? override : resolve(cwd, override);
  }
  return resolve(cwd, ".cursor/mcp.json");
}

function isDockerContainer(): boolean {
  return existsSync("/.dockerenv");
}

function expandEnvInString(s: string): string {
  return s.replace(
    /\$\{env:([^}]+)\}/g,
    (_, name: string) => process.env[name] ?? "",
  );
}

function expandPlaceholdersInString(s: string, workspaceRoot: string): string {
  return expandEnvInString(s)
    .replaceAll("${workspaceFolder}", workspaceRoot)
    .replaceAll("${workspaceFolderBasename}", basename(workspaceRoot));
}

function expandEnvDeep(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === "string") {
    return expandPlaceholdersInString(value, workspaceRoot);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandEnvDeep(entry, workspaceRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        expandEnvDeep(v, workspaceRoot),
      ]),
    );
  }
  return value;
}

/**
 * Load Cursor-style `.cursor/mcp.json` and return `mcpServers` for `Agent.create` / `Agent.resume`.
 * Supports `${env:VAR}`, `${workspaceFolder}`, and `${workspaceFolderBasename}` in strings.
 */
export function loadMcpServersFromFile(
  configPath: string,
  workspaceRoot: string = agentCwd(),
): Record<string, McpServerConfig> | undefined {
  const absolute = isAbsolute(configPath)
    ? configPath
    : resolve(workspaceRoot, configPath);

  if (!existsSync(absolute)) {
    console.error(`[mcp] config not found: ${absolute}`);
    lastLoadedServerNames = [];
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  } catch (e) {
    console.error("[mcp] invalid JSON in MCP config:", e);
    lastLoadedServerNames = [];
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || !("mcpServers" in parsed)) {
    console.error("[mcp] missing top-level mcpServers key");
    lastLoadedServerNames = [];
    return undefined;
  }

  const raw = (parsed as { mcpServers: unknown }).mcpServers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    lastLoadedServerNames = [];
    return undefined;
  }

  const expanded = expandEnvDeep(raw, workspaceRoot) as Record<
    string,
    McpServerConfig
  >;
  const keys = Object.keys(expanded);
  if (keys.length === 0) {
    lastLoadedServerNames = [];
    return undefined;
  }

  lastLoadedServerNames = keys;
  console.error(`[mcp] loaded ${keys.length} server(s): ${keys.join(", ")}`);
  console.error(`[mcp] from ${absolute}`);
  return expanded;
}

/**
 * MCP config for the Amelia backend agent.
 * In Docker with HA env vars, uses HTTP MCP to Home Assistant (stdio discovery is unreliable).
 * On the host, loads `.cursor/mcp.json` (or `MCP_CONFIG_PATH`) like the Cursor IDE.
 */
export function loadMcpServersForSdk(
  configPath?: string,
  workspaceRoot: string = agentCwd(),
): Record<string, McpServerConfig> | undefined {
  const url = process.env.HA_MCP_HTTP_URL?.trim();
  const token = process.env.HA_API_ACCESS_TOKEN?.trim();
  const forceFile = process.env.CURSOR_SDK_MCP_MODE === "file";

  if (!forceFile && isDockerContainer() && url && token) {
    console.error(
      "[mcp] docker: using HTTP MCP to HA (stdio/uvx skipped for SDK discovery)",
    );
    lastLoadedServerNames = ["home-assistant"];
    return {
      "home-assistant": {
        type: "http",
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, text/event-stream",
        },
      },
    };
  }

  const path = configPath ?? resolveMcpConfigPath(workspaceRoot);
  return loadMcpServersFromFile(path, workspaceRoot);
}
