/**
 * WebSocket hook — connects to the orchestrator and dispatches
 * events into Zustand stores.
 *
 * Key design decisions to avoid infinite render loops:
 *
 * 1. Store actions are accessed via getState() inside callbacks, NOT
 *    subscribed as React values. This means they never appear in
 *    useCallback/useEffect dependency arrays.
 *
 * 2. A `disposedRef` flag prevents reconnection and state updates
 *    after the useEffect cleanup runs.
 *
 * 3. The cleanup detaches onclose/onerror BEFORE calling ws.close()
 *    to prevent the close handler from scheduling a stale reconnect.
 *
 * 4. The effect only depends on [wsUrl, apiToken, paired] — the
 *    values that determine WHETHER and WHERE to connect.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "../stores/connection";
import { useSessionStore } from "../stores/sessions";
import { handleWsEvent } from "../lib/event-handler";

export function useWebSocket() {
  // Only subscribe to values that determine connection parameters.
  // Store actions are accessed via getState() inside callbacks to
  // avoid dependency-array instability.
  const wsUrl = useConnectionStore((s) => s.wsUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    if (!wsUrl || !paired) return;

    disposedRef.current = false;

    function connect() {
      if (disposedRef.current) return;

      const url = `${wsUrl}/ws?token=${apiToken}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (disposedRef.current) {
          ws.close();
          return;
        }
        console.log("[ws] connected");
        useConnectionStore.getState().setWsConnected(true);
      };

      ws.onmessage = (event) => {
        if (disposedRef.current) return;
        try {
          const data = JSON.parse(event.data as string);

          // Status messages from orchestrator
          if (data.type === "status") {
            useConnectionStore.getState().setDaemonStatus(
              data.daemonConnected ?? false,
              data.opencodeReady ?? false,
            );
            return;
          }

          // Event messages relayed from daemon
          if (data.type === "event" && data.event) {
            handleWsEvent(
              useSessionStore.getState(),
              data.event,
              data.sessionId,
            );
          }
        } catch (err) {
          console.error("[ws] parse error:", err);
        }
      };

      ws.onclose = () => {
        if (disposedRef.current) return;
        console.log("[ws] disconnected");
        useConnectionStore.getState().setWsConnected(false);
        useSessionStore.getState().markAllStreamsComplete();
        // Reconnect after 2s
        reconnectTimer.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        // React Native WebSocket errors are opaque Event objects with
        // no useful info. Using console.warn instead of console.error
        // avoids triggering the red LogBox error overlay on dev builds.
        if (!disposedRef.current) {
          console.warn("[ws] connection error");
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      disposedRef.current = true;

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      if (wsRef.current) {
        // Detach handlers BEFORE closing to prevent onclose from
        // scheduling a reconnect or updating state during cleanup.
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, apiToken, paired]);
}
