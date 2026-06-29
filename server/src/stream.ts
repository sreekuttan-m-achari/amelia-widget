import type {
  LocalRunStreamSdkMessageEvent,
  SDKAssistantMessage,
  SDKMessage,
} from "@cursor/sdk";

import type { AmeliaAgent } from "./agent.js";
import { withAgentBusyRecovery } from "./agent-busy.js";
import { ChatCancelledError } from "./errors.js";
import {
  registerActiveRun,
  unregisterActiveRun,
} from "./runs.js";

type Collector = {
  reset: () => void;
  handleEvent: (event: unknown) => void;
  getText: () => string;
};

function isWrappedStreamEvent(e: unknown): e is LocalRunStreamSdkMessageEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { type?: unknown }).type === "sdk_message" &&
    "message" in e &&
    typeof (e as { message?: unknown }).message === "object" &&
    (e as { message?: { type?: unknown } }).message !== null
  );
}

function isSdkMessage(e: unknown): e is SDKMessage {
  return (
    typeof e === "object" &&
    e !== null &&
    "type" in e &&
    typeof (e as { type: unknown }).type === "string"
  );
}

export function createStreamingCollector(
  onChunk?: (text: string) => void,
): Collector {
  let text = "";

  function appendAssistant(msg: SDKAssistantMessage): void {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text.length > 0) {
        text += block.text;
        onChunk?.(block.text);
      }
    }
  }

  function reset(): void {
    text = "";
  }

  function handleEvent(event: unknown): void {
    if (isWrappedStreamEvent(event)) {
      if (event.message.type === "assistant") {
        appendAssistant(event.message);
      }
      return;
    }
    if (isSdkMessage(event) && event.type === "assistant") {
      appendAssistant(event);
    }
  }

  return {
    reset,
    handleEvent,
    getText: () => text,
  };
}

export async function runChatTurn(
  agent: AmeliaAgent,
  prompt: string,
  onChunk?: (text: string) => void,
  chatId?: string,
): Promise<string> {
  return withAgentBusyRecovery(agent.agentId, () =>
    runChatTurnOnce(agent, prompt, onChunk, chatId),
  );
}

async function runChatTurnOnce(
  agent: AmeliaAgent,
  prompt: string,
  onChunk?: (text: string) => void,
  chatId?: string,
): Promise<string> {
  const collector = createStreamingCollector(onChunk);
  collector.reset();

  const run = await agent.send(prompt);
  if (chatId) {
    registerActiveRun(chatId, run);
  }

  try {
    for await (const event of run.stream()) {
      collector.handleEvent(event);
    }
    const result = await run.wait();
    if (result.status === "cancelled") {
      throw new ChatCancelledError(collector.getText().trim());
    }
    if (result.status === "error") {
      throw new Error("agent run failed");
    }

    const reply = collector.getText().trim();
    return reply || "(no reply)";
  } catch (err) {
    if (err instanceof ChatCancelledError) {
      throw err;
    }
    if (run.status === "cancelled") {
      throw new ChatCancelledError(collector.getText().trim());
    }
    throw err;
  } finally {
    if (chatId) {
      unregisterActiveRun(chatId);
    }
  }
}
