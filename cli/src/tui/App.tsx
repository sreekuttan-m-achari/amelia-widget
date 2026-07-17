import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import WebSocket from "ws";

import {
  apiBase,
  connectWebSocket,
  fetchHealth,
  nextChatId,
  wsSend,
  type ServerEvent,
} from "../api.js";

type Role = "user" | "assistant" | "system";

type ChatLine = {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
};

type ConnectionState = "checking" | "offline" | "warming" | "online" | "thinking";

function statusLabel(state: ConnectionState): string {
  switch (state) {
    case "checking":
      return "checking…";
    case "offline":
      return "offline";
    case "warming":
      return "warming…";
    case "online":
      return "online";
    case "thinking":
      return "thinking…";
  }
}

function statusColor(state: ConnectionState): string {
  switch (state) {
    case "online":
      return "green";
    case "thinking":
      return "yellow";
    case "warming":
      return "cyan";
    case "offline":
      return "red";
    default:
      return "gray";
  }
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const wsRef = useRef<ReturnType<typeof connectWebSocket> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [greeting, setGreeting] = useState<string | undefined>();
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [hint, setHint] = useState("Enter send · Ctrl+C cancel/quit");

  const pushSystem = useCallback((text: string) => {
    setLines((prev) => [
      ...prev,
      { id: `sys-${prev.length}`, role: "system", text },
    ]);
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const health = await fetchHealth();
      if (health.warm) {
        setConnection((c) => (c === "thinking" ? c : "online"));
      } else {
        setConnection((c) => (c === "thinking" ? c : "warming"));
      }
      if (health.greeting) setGreeting(health.greeting);
    } catch {
      setConnection((c) => (c === "thinking" ? c : "offline"));
    }
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "ready") {
        if (event.greeting) setGreeting(event.greeting);
        setConnection(event.warm ? "online" : "warming");
        return;
      }
      if (event.type === "greeting") {
        setGreeting(event.text);
        return;
      }
      if (event.type === "chunk") {
        setLines((prev) => {
          const idx = prev.findIndex(
            (l) => l.role === "assistant" && l.id === event.id,
          );
          if (idx < 0) {
            return [
              ...prev,
              {
                id: event.id,
                role: "assistant",
                text: event.text,
                streaming: true,
              },
            ];
          }
          const next = [...prev];
          next[idx] = {
            ...next[idx]!,
            text: next[idx]!.text + event.text,
            streaming: true,
          };
          return next;
        });
        return;
      }
      if (event.type === "done") {
        activeIdRef.current = null;
        setConnection("online");
        setLines((prev) => {
          const idx = prev.findIndex(
            (l) => l.role === "assistant" && l.id === event.id,
          );
          if (idx < 0) {
            return [
              ...prev,
              { id: event.id, role: "assistant", text: event.reply },
            ];
          }
          const next = [...prev];
          next[idx] = {
            ...next[idx]!,
            text: event.reply,
            streaming: false,
          };
          return next;
        });
        return;
      }
      if (event.type === "cancelled") {
        activeIdRef.current = null;
        setConnection("online");
        const partial = event.reply?.trim();
        pushSystem(partial ? `Cancelled. Partial: ${partial}` : "Cancelled.");
        setLines((prev) =>
          prev.map((l) =>
            l.id === event.id ? { ...l, streaming: false } : l,
          ),
        );
        return;
      }
      if (event.type === "error") {
        if (event.id && activeIdRef.current === event.id) {
          activeIdRef.current = null;
          setConnection("online");
        }
        pushSystem(event.error);
      }
    },
    [pushSystem],
  );

  useEffect(() => {
    void refreshHealth();
    const healthTimer = setInterval(() => void refreshHealth(), 5000);

    const ws = connectWebSocket({
      onOpen: () => {
        wsSend(ws, { type: "ping" });
      },
      onClose: () => {
        if (activeIdRef.current) return;
        setConnection("offline");
      },
      onEvent: handleServerEvent,
      onError: () => {
        if (activeIdRef.current) return;
        setConnection("offline");
      },
    });
    wsRef.current = ws;

    return () => {
      clearInterval(healthTimer);
      ws.close();
    };
  }, [handleServerEvent, refreshHealth]);

  const sendMessage = useCallback(() => {
    const message = input.trim();
    if (!message) return;
    if (activeIdRef.current) {
      setHint("Wait for the current reply or press Ctrl+C to cancel");
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pushSystem("Not connected — is amelia-widget running?");
      return;
    }

    const id = nextChatId();
    activeIdRef.current = id;
    setConnection("thinking");
    setInput("");
    setHint("Ctrl+C cancel · Esc quit");

    setLines((prev) => [
      ...prev,
      { id: `u-${id}`, role: "user", text: message },
    ]);
    wsSend(wsRef.current, { type: "chat", id, message });
  }, [input, pushSystem]);

  const cancelActive = useCallback(() => {
    const id = activeIdRef.current;
    if (!id || !wsRef.current) return false;
    wsSend(wsRef.current, { type: "cancel", id });
    return true;
  }, []);

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === "c") {
      if (cancelActive()) {
        setHint("Cancelling…");
        return;
      }
      exit();
      return;
    }
    if (key.escape) {
      if (activeIdRef.current) {
        cancelActive();
        return;
      }
      exit();
      return;
    }
    if (key.return) {
      sendMessage();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (inputKey && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((v) => v + inputKey);
    }
  });

  const recent = lines.slice(-12);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          Amelia
        </Text>
        <Text> · </Text>
        <Text color="gray">{apiBase()}</Text>
        <Text> · </Text>
        <Text color={statusColor(connection)}>{statusLabel(connection)}</Text>
      </Box>

      {greeting ? (
        <Box marginBottom={1}>
          <Text color="cyan" wrap="wrap">
            {greeting}
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginBottom={1}>
        {recent.length === 0 ? (
          <Text color="gray" dimColor>
            Type a message and press Enter.
          </Text>
        ) : (
          recent.map((line) => (
            <Box key={line.id} flexDirection="column" marginBottom={0}>
              <Text
                bold={line.role !== "system"}
                color={
                  line.role === "user"
                    ? "blue"
                    : line.role === "assistant"
                      ? "white"
                      : "yellow"
                }
                wrap="wrap"
              >
                {line.role === "user"
                  ? `You: ${line.text}`
                  : line.role === "assistant"
                    ? `Amelia: ${line.text}${line.streaming ? "▌" : ""}`
                    : line.text}
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="green">{"> "}</Text>
        <Text>{input}</Text>
        <Text color="gray">▌</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {hint}
        </Text>
      </Box>
    </Box>
  );
}
