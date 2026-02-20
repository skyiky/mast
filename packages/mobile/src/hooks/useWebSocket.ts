/**
 * WebSocket hook — connects to the orchestrator and dispatches
 * events into Zustand stores.
 */

import { useEffect, useRef, useCallback } from "react";
import { useConnectionStore } from "../stores/connection";
import { useSessionStore } from "../stores/sessions";
import type { MessagePart } from "../stores/sessions";

export function useWebSocket() {
  const wsUrl = useConnectionStore((s) => s.wsUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);
  const setWsConnected = useConnectionStore((s) => s.setWsConnected);
  const setDaemonStatus = useConnectionStore((s) => s.setDaemonStatus);

  const addMessage = useSessionStore((s) => s.addMessage);
  const updateLastTextPart = useSessionStore((s) => s.updateLastTextPart);
  const markMessageComplete = useSessionStore((s) => s.markMessageComplete);
  const markAllStreamsComplete = useSessionStore((s) => s.markAllStreamsComplete);
  const addPermission = useSessionStore((s) => s.addPermission);
  const updatePermission = useSessionStore((s) => s.updatePermission);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!wsUrl || !paired) return;

    const url = `${wsUrl}/ws?token=${apiToken}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("[ws] connected");
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);

        // Status messages from orchestrator
        if (data.type === "status") {
          setDaemonStatus(
            data.daemonConnected ?? false,
            data.opencodeReady ?? false,
          );
          return;
        }

        // Event messages relayed from daemon
        if (data.type === "event" && data.event) {
          handleEvent(data.event, data.sessionId);
        }
      } catch (err) {
        console.error("[ws] parse error:", err);
      }
    };

    ws.onclose = () => {
      console.log("[ws] disconnected");
      setWsConnected(false);
      markAllStreamsComplete();
      // Reconnect after 2s
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error("[ws] error:", err);
    };

    wsRef.current = ws;
  }, [wsUrl, apiToken, paired, setWsConnected, setDaemonStatus, markAllStreamsComplete]);

  const handleEvent = useCallback(
    (event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }, sessionId?: string) => {
      // Normalize: OpenCode uses "properties", our relay normalizes to "data"
      const props = (event.data ?? event.properties ?? {}) as Record<string, unknown>;
      const sid = (sessionId ?? props.sessionID ?? "") as string;

      switch (event.type) {
        case "message.created": {
          const msg = props.message as { id: string; role: string } | undefined;
          if (msg && sid) {
            addMessage(sid, {
              id: msg.id,
              role: msg.role as "user" | "assistant",
              parts: [],
              streaming: msg.role === "assistant",
              createdAt: new Date().toISOString(),
            });
          }
          break;
        }

        case "message.part.created":
        case "message.part.updated": {
          const part = props.part as {
            type: string;
            content?: string;
            toolName?: string;
            toolArgs?: string;
          } | undefined;
          const messageID = props.messageID as string | undefined;

          if (part && messageID && sid) {
            if (part.type === "text" && part.content !== undefined) {
              updateLastTextPart(sid, messageID, part.content);
            }
            // For tool invocations and other part types, we could add
            // more specific handling here in the future
          }
          break;
        }

        case "message.completed": {
          const messageID = props.messageID as string | undefined;
          if (messageID && sid) {
            markMessageComplete(sid, messageID);
          }
          break;
        }

        case "permission.created": {
          const perm = props.permission as {
            id: string;
            description?: string;
          } | undefined;
          if (perm && sid) {
            addPermission({
              id: perm.id,
              sessionId: sid,
              description: perm.description ?? "Permission requested",
              status: "pending",
              createdAt: new Date().toISOString(),
            });
          }
          break;
        }

        case "permission.updated": {
          const perm = props.permission as {
            id: string;
            status?: string;
          } | undefined;
          if (perm) {
            updatePermission(
              perm.id,
              (perm.status as "approved" | "denied") ?? "approved",
            );
          }
          break;
        }
      }
    },
    [addMessage, updateLastTextPart, markMessageComplete, addPermission, updatePermission],
  );

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
