import type { Run } from "@cursor/sdk";

const activeRuns = new Map<string, Run>();

export function registerActiveRun(chatId: string, run: Run): void {
  activeRuns.set(chatId, run);
}

export function unregisterActiveRun(chatId: string): void {
  activeRuns.delete(chatId);
}

export function hasActiveRun(chatId: string): boolean {
  return activeRuns.has(chatId);
}

export async function cancelActiveRun(chatId: string): Promise<boolean> {
  const run = activeRuns.get(chatId);
  if (!run) {
    return false;
  }
  try {
    if (run.supports("cancel")) {
      await run.cancel();
    }
    return true;
  } catch (err) {
    console.error(`[amelia-runs] cancel failed for ${chatId}:`, err);
    return false;
  }
}
