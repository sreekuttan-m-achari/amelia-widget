import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getDefaultSdkStateRoot } from "@cursor/sdk";

export function sessionDir(cwd: string): string {
  const dir =
    process.env.AMELIA_SESSION_DIR?.trim() ||
    join(getDefaultSdkStateRoot(cwd), "amelia-widget");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function agentIdPath(cwd: string): string {
  return join(sessionDir(cwd), "agent-id.txt");
}

export function loadPersistedAgentId(cwd: string): string | undefined {
  const path = agentIdPath(cwd);
  if (!existsSync(path)) {
    return undefined;
  }
  const id = readFileSync(path, "utf8").trim();
  return id.length > 0 ? id : undefined;
}

export function persistAgentId(cwd: string, agentId: string): void {
  writeFileSync(agentIdPath(cwd), `${agentId}\n`, "utf8");
}
