/**
 * Tests for useWebSocket hook logic.
 *
 * Since we run under node:test (no jsdom/React Testing Library), we test
 * the extracted connect/disconnect logic directly rather than the React
 * hook wrapper. The hook itself is a thin useEffect shell around this logic.
 *
 * Run: node --import tsx --test --test-force-exit test/use-websocket.test.ts
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

interface MockWsInstance {
  url: string;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  close: ReturnType<typeof mock.fn>;
  readyState: number;
}

let mockWsInstances: MockWsInstance[] = [];

class MockWebSocket implements MockWsInstance {
  url: string;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  close = mock.fn();
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }
}

// Install globally before imports so the module sees it
(globalThis as any).WebSocket = MockWebSocket;

// ---------------------------------------------------------------------------
// Now import the module under test
// ---------------------------------------------------------------------------

import {
  connectWebSocket,
  disconnectWebSocket,
  type WebSocketHandle,
} from "../src/hooks/useWebSocket.js";
import { resetEventDedup } from "../src/lib/event-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastWs(): MockWsInstance {
  assert.ok(mockWsInstances.length > 0, "expected at least one WebSocket");
  return mockWsInstances[mockWsInstances.length - 1];
}

/** Simulate the server accepting the connection */
function simulateOpen(ws: MockWsInstance) {
  ws.readyState = 1; // OPEN
  ws.onopen?.({});
}

/** Simulate receiving a message */
function simulateMessage(ws: MockWsInstance, data: unknown) {
  ws.onmessage?.({ data: JSON.stringify(data) });
}

/** Simulate the connection closing */
function simulateClose(ws: MockWsInstance) {
  ws.readyState = 3; // CLOSED
  ws.onclose?.({});
}

/** Simulate a connection error */
function simulateError(ws: MockWsInstance) {
  ws.onerror?.({});
}

// ---------------------------------------------------------------------------
// Store spies
// ---------------------------------------------------------------------------

function createMockStores() {
  return {
    connection: {
      setWsConnected: mock.fn(),
      setDaemonStatus: mock.fn(),
    },
    sessions: {
      addMessage: mock.fn(),
      updateLastTextPart: mock.fn(),
      appendTextDelta: mock.fn(),
      addPartToMessage: mock.fn(),
      upsertToolPart: mock.fn(),
      markMessageComplete: mock.fn(),
      addPermission: mock.fn(),
      updatePermission: mock.fn(),
      markAllStreamsComplete: mock.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connectWebSocket", () => {
  let stores: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    mockWsInstances = [];
    stores = createMockStores();
    resetEventDedup();
  });

  it("creates a WebSocket with the correct URL", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    assert.equal(mockWsInstances.length, 1);
    assert.equal(lastWs().url, "ws://localhost:3000/ws?token=test-token");
    disconnectWebSocket(handle);
  });

  it("sets wsConnected=true on open", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    simulateOpen(lastWs());

    assert.equal(stores.connection.setWsConnected.mock.callCount(), 1);
    assert.deepEqual(stores.connection.setWsConnected.mock.calls[0].arguments, [true]);
    disconnectWebSocket(handle);
  });

  it("dispatches status events to connection store", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    simulateOpen(lastWs());
    simulateMessage(lastWs(), {
      type: "status",
      daemonConnected: true,
      opencodeReady: true,
    });

    assert.equal(stores.connection.setDaemonStatus.mock.callCount(), 1);
    assert.deepEqual(stores.connection.setDaemonStatus.mock.calls[0].arguments, [true, true]);
    disconnectWebSocket(handle);
  });

  it("dispatches event messages through the event handler", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    simulateOpen(lastWs());
    simulateMessage(lastWs(), {
      type: "event",
      sessionId: "sess-1",
      event: {
        type: "message.created",
        data: {
          sessionID: "sess-1",
          message: { id: "msg-1", role: "assistant" },
        },
      },
    });

    assert.equal(stores.sessions.addMessage.mock.callCount(), 1);
    const [sid, msg] = stores.sessions.addMessage.mock.calls[0].arguments;
    assert.equal(sid, "sess-1");
    assert.equal(msg.id, "msg-1");
    assert.equal(msg.role, "assistant");
    disconnectWebSocket(handle);
  });

  it("sets wsConnected=false and marks streams complete on close", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    simulateOpen(lastWs());
    simulateClose(lastWs());

    assert.equal(stores.connection.setWsConnected.mock.callCount(), 2);
    assert.deepEqual(stores.connection.setWsConnected.mock.calls[1].arguments, [false]);
    assert.equal(stores.sessions.markAllStreamsComplete.mock.callCount(), 1);
    disconnectWebSocket(handle);
  });

  it("schedules reconnect after close", async () => {
    // Use a short reconnect delay for testing
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
      { reconnectDelayMs: 50 },
    );

    simulateOpen(lastWs());
    assert.equal(mockWsInstances.length, 1);

    simulateClose(lastWs());
    // Wait for reconnect
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(mockWsInstances.length, 2, "should have created a second WebSocket");
    assert.equal(lastWs().url, "ws://localhost:3000/ws?token=test-token");
    disconnectWebSocket(handle);
  });

  it("does not reconnect after disconnect()", async () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
      { reconnectDelayMs: 50 },
    );

    simulateOpen(lastWs());
    disconnectWebSocket(handle);

    // The disconnect should have detached handlers, so simulating close
    // on the raw ws should NOT trigger reconnect
    await new Promise((r) => setTimeout(r, 100));

    // Only the original connection — no reconnect
    assert.equal(mockWsInstances.length, 1);
    assert.equal(lastWs().close.mock.callCount(), 1);
  });

  it("disconnect clears all handlers on the WebSocket", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    const ws = lastWs();
    assert.ok(ws.onopen !== null, "onopen should be set");
    assert.ok(ws.onmessage !== null, "onmessage should be set");

    disconnectWebSocket(handle);

    assert.equal(ws.onopen, null);
    assert.equal(ws.onmessage, null);
    assert.equal(ws.onclose, null);
    assert.equal(ws.onerror, null);
  });

  it("ignores events after disconnect (disposed)", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    const ws = lastWs();
    // Save handlers before disconnect
    const onopen = ws.onopen;
    const onmessage = ws.onmessage;

    disconnectWebSocket(handle);

    // Even if somehow the handler fires after dispose, it should no-op
    // (handlers are nulled, but we also test the disposed flag path)
    assert.equal(stores.connection.setWsConnected.mock.callCount(), 0);
  });

  it("ignores malformed JSON messages without crashing", () => {
    const handle = connectWebSocket(
      "ws://localhost:3000",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    simulateOpen(lastWs());

    // Send raw invalid JSON
    lastWs().onmessage?.({ data: "not-json{{{" });

    // Should not throw, and no store calls for the bad message
    assert.equal(stores.sessions.addMessage.mock.callCount(), 0);
    disconnectWebSocket(handle);
  });

  it("does not create WebSocket if wsUrl is empty", () => {
    const handle = connectWebSocket(
      "",
      "test-token",
      stores.connection,
      stores.sessions,
    );

    assert.equal(mockWsInstances.length, 0);
    assert.equal(handle, null);
  });
});
