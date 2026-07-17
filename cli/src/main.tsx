import { render } from "ink";
import React from "react";

import { runCancel, runChat } from "./commands/chat.js";
import { runHealth } from "./commands/health.js";
import { App } from "./tui/App.js";

function usage(): void {
  console.log(`Amelia terminal client

Usage:
  amelia                 Interactive TUI (default)
  amelia tui             Same as above
  amelia chat <message>  One-shot chat (streams reply to stdout)
  amelia health          Server status
  amelia cancel <id>     Cancel an in-flight turn

Environment:
  AMELIA_API_URL         e.g. http://127.0.0.1:8787
  AMELIA_WS_HOST         default 127.0.0.1
  AMELIA_WS_PORT         default 8787

Ensure the backend is running:
  systemctl --user status amelia-widget
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "tui") {
    render(<App />);
    return;
  }

  const [cmd, ...rest] = args;

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    process.exit(0);
  }

  if (cmd === "health") {
    const json = rest.includes("--json");
    process.exit(await runHealth(json));
  }

  if (cmd === "chat") {
    const json = rest.includes("--json");
    const message = rest.filter((a) => a !== "--json").join(" ").trim();
    if (!message) {
      console.error("Usage: amelia chat <message>");
      process.exit(1);
    }
    process.exit(await runChat(message, { json }));
  }

  if (cmd === "cancel") {
    const id = rest[0]?.trim();
    if (!id) {
      console.error("Usage: amelia cancel <id>");
      process.exit(1);
    }
    process.exit(await runCancel(id));
  }

  // Bare message shorthand: amelia "hello"
  if (!cmd.startsWith("-")) {
    process.exit(await runChat(args.join(" "), {}));
    return;
  }

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
