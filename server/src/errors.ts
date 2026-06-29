export class ChatCancelledError extends Error {
  readonly partialReply: string;

  constructor(partialReply = "") {
    super("cancelled");
    this.name = "ChatCancelledError";
    this.partialReply = partialReply;
  }
}

export function isChatCancelled(err: unknown): err is ChatCancelledError {
  return err instanceof ChatCancelledError;
}
