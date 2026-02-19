/**
 * WebSocket hook for receiving streamed events from the orchestrator.
 *
 * Connects to ws://<host>/ws?token=<apiToken> and dispatches events
 * to update the chat message list.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { ServerConfig, ChatMessage, MessagePart } from "../types";

interface UseWebSocketOptions {
  config: ServerConfig;
  onMessage: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;
}

export function useWebSocket({ config, onMessage }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const url = `${config.wsUrl}/ws?token=${config.apiToken}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[ws] connected");
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "event") {
          handleEvent(data.event, onMessage);
        }
      } catch (err) {
        console.error("[ws] parse error:", err);
      }
    };

    ws.onclose = () => {
      console.log("[ws] disconnected");
      setConnected(false);
      // Reconnect after 2 seconds
      setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error("[ws] error:", err);
    };

    wsRef.current = ws;
  }, [config, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected };
}

function handleEvent(
  event: { type: string; data?: unknown },
  onMessage: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void,
) {
  const props = (event as { type: string; data?: unknown; properties?: Record<string, unknown> })
    .properties as Record<string, unknown> | undefined;

  switch (event.type) {
    case "message.created": {
      const msg = props?.message as { id: string; role: string } | undefined;
      if (msg && msg.role === "assistant") {
        onMessage((prev) => {
          // Don't add duplicate
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [
            ...prev,
            {
              id: msg.id,
              role: "assistant" as const,
              parts: [],
              streaming: true,
              createdAt: new Date().toISOString(),
            },
          ];
        });
      }
      break;
    }

    case "message.part.created":
    case "message.part.updated": {
      const part = props?.part as { type: string; content?: string } | undefined;
      const sessionID = props?.sessionID as string | undefined;
      if (part) {
        onMessage((prev) => {
          // Find the last assistant message that's streaming
          const lastIdx = prev.findLastIndex(
            (m) => m.role === "assistant" && m.streaming,
          );
          if (lastIdx === -1) return prev;

          const updated = [...prev];
          const message = { ...updated[lastIdx] };

          // For simplicity in Phase 2, we treat text content as a single part
          // that gets updated (replaced) as streaming progresses
          if (part.type === "text" && part.content !== undefined) {
            const textPartIdx = message.parts.findIndex((p) => p.type === "text");
            const newParts = [...message.parts];
            if (textPartIdx >= 0) {
              newParts[textPartIdx] = { type: "text", content: part.content };
            } else {
              newParts.push({ type: "text", content: part.content });
            }
            message.parts = newParts;
          }

          updated[lastIdx] = message;
          return updated;
        });
      }
      break;
    }

    case "message.completed": {
      onMessage((prev) => {
        return prev.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
      });
      break;
    }
  }
}
