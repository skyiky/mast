/**
 * WebSocket hook — connects to the orchestrator and dispatches
 * events into Zustand stores.
 *
 * Architecture: The imperative connect/disconnect logic is extracted as
 * `connectWebSocket` / `disconnectWebSocket` for testability under
 * node:test (no jsdom). The `useWebSocket` React hook is a thin
 * useEffect shell that calls these functions.
 *
 * Key design decisions to avoid infinite render loops:
 *
 * 1. Store actions are accessed via getState() inside callbacks, NOT
 *    subscribed as React values. This means they never appear in
 *    useCallback/useEffect dependency arrays.
 *
 * 2. A `disposed` flag prevents reconnection and state updates
 *    after disconnect.
 *
 * 3. The cleanup detaches onclose/onerror BEFORE calling ws.close()
 *    to prevent the close handler from scheduling a stale reconnect.
 *
 * 4. The effect only depends on [wsUrl, apiToken, paired] — the
 *    values that determine WHETHER and WHERE to connect.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { useSessionStore } from "../stores/sessions.js";
import { handleWsEvent, resetEventDedup } from "../lib/event-handler.js";

// ---------------------------------------------------------------------------
// Imperative connect/disconnect API (testable without React)
// ---------------------------------------------------------------------------

/** Minimal store interface needed by the WebSocket connection logic. */
export interface ConnectionStoreDeps {
  setWsConnected: (connected: boolean) => void;
  setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) => void;
}

/** Minimal session store interface needed by the WebSocket connection logic. */
export interface SessionStoreDeps {
  addMessage: (...args: any[]) => void;
  updateLastTextPart: (...args: any[]) => void;
  appendTextDelta: (...args: any[]) => void;
  addPartToMessage: (...args: any[]) => void;
  upsertToolPart: (...args: any[]) => void;
  markMessageComplete: (...args: any[]) => void;
  addPermission: (...args: any[]) => void;
  updatePermission: (...args: any[]) => void;
  markAllStreamsComplete: () => void;
}

export interface WebSocketHandle {
  /** Flag indicating whether this handle has been disposed. */
  disposed: boolean;
  /** Current WebSocket instance (may be null between reconnects). */
  ws: WebSocket | null;
  /** Pending reconnect timer. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export interface ConnectOptions {
  /** Delay before reconnecting after disconnect (default 2000ms). */
  reconnectDelayMs?: number;
}

/**
 * Establish a WebSocket connection to the orchestrator.
 * Returns a handle that can be passed to `disconnectWebSocket` for cleanup,
 * or null if wsUrl is empty.
 */
export function connectWebSocket(
  wsUrl: string,
  apiToken: string,
  connectionStore: ConnectionStoreDeps,
  sessionStore: SessionStoreDeps,
  options?: ConnectOptions,
): WebSocketHandle | null {
  if (!wsUrl) return null;

  const reconnectDelay = options?.reconnectDelayMs ?? 2000;

  const handle: WebSocketHandle = {
    disposed: false,
    ws: null,
    reconnectTimer: null,
  };

  function connect() {
    if (handle.disposed) return;

    const url = `${wsUrl}/ws?token=${apiToken}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (handle.disposed) {
        ws.close();
        return;
      }
      console.log("[ws] connected");
      resetEventDedup();
      connectionStore.setWsConnected(true);
    };

    ws.onmessage = (event) => {
      if (handle.disposed) return;
      try {
        const data = JSON.parse(event.data as string);

        // Status messages from orchestrator
        if (data.type === "status") {
          connectionStore.setDaemonStatus(
            data.daemonConnected ?? false,
            data.opencodeReady ?? false,
          );
          return;
        }

        // Event messages relayed from daemon
        if (data.type === "event" && data.event) {
          handleWsEvent(
            sessionStore,
            data.event,
            data.sessionId,
          );
        }
      } catch (err) {
        console.error("[ws] parse error:", err);
      }
    };

    ws.onclose = () => {
      if (handle.disposed) return;
      console.log("[ws] disconnected");
      connectionStore.setWsConnected(false);
      sessionStore.markAllStreamsComplete();
      // Reconnect after delay
      handle.reconnectTimer = setTimeout(connect, reconnectDelay);
    };

    ws.onerror = () => {
      if (!handle.disposed) {
        console.warn("[ws] connection error");
      }
    };

    handle.ws = ws;
  }

  connect();

  return handle;
}

/**
 * Tear down a WebSocket connection cleanly.
 * Detaches all handlers before closing to prevent stale reconnects.
 */
export function disconnectWebSocket(handle: WebSocketHandle | null): void {
  if (!handle) return;

  handle.disposed = true;

  if (handle.reconnectTimer) {
    clearTimeout(handle.reconnectTimer);
    handle.reconnectTimer = null;
  }

  if (handle.ws) {
    handle.ws.onopen = null;
    handle.ws.onmessage = null;
    handle.ws.onclose = null;
    handle.ws.onerror = null;
    handle.ws.close();
    handle.ws = null;
  }
}

// ---------------------------------------------------------------------------
// React hook (thin wrapper)
// ---------------------------------------------------------------------------

export function useWebSocket() {
  const wsUrl = useConnectionStore((s) => s.wsUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);

  const handleRef = useRef<WebSocketHandle | null>(null);

  useEffect(() => {
    if (!wsUrl || !paired) return;

    handleRef.current = connectWebSocket(
      wsUrl,
      apiToken,
      useConnectionStore.getState(),
      useSessionStore.getState(),
    );

    return () => {
      disconnectWebSocket(handleRef.current);
      handleRef.current = null;
    };
  }, [wsUrl, apiToken, paired]);
}
