import { resetAgentSession } from "./agent-manager.js";
import type { AmeliaAgent } from "./agent.js";
import {
  logConversation,
  logStreamChunk,
  type ConversationTransport,
} from "./debug.js";
import { isChatCancelled } from "./errors.js";
import { waitForWarmup } from "./warmup.js";
import { isRecoverableRunError, runChatTurn } from "./stream.js";

export async function handleChatTurn(
  agent: AmeliaAgent,
  transport: ConversationTransport,
  id: string,
  message: string,
  onChunk?: (text: string) => void,
  allowSessionReset = true,
): Promise<string> {
  await waitForWarmup();
  const started = Date.now();
  try {
    const reply = await runChatTurn(
      agent,
      message,
      (text) => {
        logStreamChunk(id, text);
        onChunk?.(text);
      },
      id,
    );
    logConversation({
      transport,
      id,
      user: message,
      reply,
      durationMs: Date.now() - started,
    });
    return reply;
  } catch (err) {
    if (isChatCancelled(err)) {
      logConversation({
        transport,
        id,
        user: message,
        error: "cancelled",
        durationMs: Date.now() - started,
      });
      throw err;
    }
    if (allowSessionReset && isRecoverableRunError(err)) {
      console.error(
        `[amelia-agent] Run failed (${err instanceof Error ? err.message : err}); resetting session and retrying once`,
      );
      const fresh = await resetAgentSession();
      await waitForWarmup();
      return handleChatTurn(
        fresh,
        transport,
        id,
        message,
        onChunk,
        false,
      );
    }
    const error = err instanceof Error ? err.message : String(err);
    logConversation({
      transport,
      id,
      user: message,
      error,
      durationMs: Date.now() - started,
    });
    throw err;
  }
}
