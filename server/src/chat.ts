import type { AmeliaAgent } from "./agent.js";
import {
  logConversation,
  logStreamChunk,
  type ConversationTransport,
} from "./debug.js";
import { isChatCancelled } from "./errors.js";
import { waitForWarmup } from "./warmup.js";
import { runChatTurn } from "./stream.js";

export async function handleChatTurn(
  agent: AmeliaAgent,
  transport: ConversationTransport,
  id: string,
  message: string,
  onChunk?: (text: string) => void,
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
