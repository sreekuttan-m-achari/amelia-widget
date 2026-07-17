import { nextChatId, postCancel, streamChat } from "../api.js";

export async function runChat(message: string, opts: { json?: boolean }): Promise<number> {
  const id = nextChatId("term");
  let streamed = "";

  try {
    const reply = await streamChat(message, id, {
      onChunk: (text) => {
        if (opts.json) return;
        streamed += text;
        process.stdout.write(text);
      },
      onDone: () => {
        if (!opts.json && streamed && !streamed.endsWith("\n")) {
          process.stdout.write("\n");
        }
      },
    });

    if (opts.json) {
      console.log(JSON.stringify({ id, reply }));
    }
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ id, error }));
    } else {
      console.error(error);
    }
    return 1;
  }
}

export async function runCancel(id: string): Promise<number> {
  try {
    const result = await postCancel(id);
    console.log(JSON.stringify(result));
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(error);
    return 1;
  }
}
