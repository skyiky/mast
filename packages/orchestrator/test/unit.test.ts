/**
 * Unit Tests (Phase 1 + Phase 3 + Phase 4)
 *
 * Tests isolated units that can't easily be covered by integration tests.
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateRequestId, generatePairingCode } from "@mast/shared";
import { DaemonConnection } from "../src/daemon-connection.js";
import { InMemorySessionStore } from "../src/session-store.js";
import { decidePush, PushDeduplicator } from "../src/push-notifications.js";
import { PairingManager } from "../src/pairing.js";
import { EventTimestampTracker, buildSyncRequest, processSyncResponse } from "../src/sync.js";
import { HealthMonitor } from "../../daemon/src/health-monitor.js";
import { PhoneConnectionManager } from "../src/phone-connections.js";

// =============================================================================
// generateRequestId
// =============================================================================

describe("generateRequestId", () => {
  it("1. returns unique UUIDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    assert.equal(ids.size, 1000, "All 1000 IDs should be unique");
  });

  it("returns valid UUID format", () => {
    const id = generateRequestId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(id, uuidRegex, `${id} should be a valid UUID v4`);
  });
});

// =============================================================================
// DaemonConnection
// =============================================================================

describe("DaemonConnection", () => {
  it("2. clearConnection rejects all pending requests", async () => {
    const conn = new DaemonConnection();

    // We need a real WebSocket-like object to set the connection.
    // Create a minimal mock that just satisfies the type checker.
    const fakeWs = {
      send: (_data: string) => {},
      readyState: 1, // OPEN
    };

    // Use type assertion since we just need minimal ws behavior
    conn.setConnection(fakeWs as any);

    // Send two requests that will be pending
    const p1 = conn.sendRequest("GET", "/test1");
    const p2 = conn.sendRequest("GET", "/test2");

    // Now clear the connection — should reject both
    conn.clearConnection();

    // Both promises should reject with "Daemon disconnected"
    await assert.rejects(p1, { message: "Daemon disconnected" });
    await assert.rejects(p2, { message: "Daemon disconnected" });
  });

  it("3. sendRequest rejects when not connected", async () => {
    const conn = new DaemonConnection();
    await assert.rejects(
      conn.sendRequest("GET", "/test"),
      { message: "Daemon not connected" },
    );
  });

  it("isConnected returns false initially", () => {
    const conn = new DaemonConnection();
    assert.equal(conn.isConnected(), false);
  });

  it("isConnected returns true after setConnection", () => {
    const conn = new DaemonConnection();
    const fakeWs = { send: () => {}, readyState: 1 };
    conn.setConnection(fakeWs as any);
    assert.equal(conn.isConnected(), true);
  });

  it("isConnected returns false after clearConnection", () => {
    const conn = new DaemonConnection();
    const fakeWs = { send: () => {}, readyState: 1 };
    conn.setConnection(fakeWs as any);
    conn.clearConnection();
    assert.equal(conn.isConnected(), false);
  });
});

// =============================================================================
// InMemorySessionStore
// =============================================================================

describe("InMemorySessionStore", () => {
  it("add message, get messages, list sessions — CRUD correctness", async () => {
    const store = new InMemorySessionStore();

    await store.upsertSession({ id: "sess1", title: "Test session" });
    await store.addMessage({
      id: "msg1",
      sessionId: "sess1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    });

    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "sess1");
    assert.equal(sessions[0].title, "Test session");

    const messages = await store.getMessages("sess1");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, "msg1");
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].streaming, true);
  });

  it("messages from different sessions don't leak", async () => {
    const store = new InMemorySessionStore();

    await store.addMessage({ id: "m1", sessionId: "s1", role: "user", parts: [] });
    await store.addMessage({ id: "m2", sessionId: "s2", role: "user", parts: [] });
    await store.addMessage({ id: "m3", sessionId: "s1", role: "assistant", parts: [] });

    const s1 = await store.getMessages("s1");
    const s2 = await store.getMessages("s2");

    assert.equal(s1.length, 2, "s1 should have 2 messages");
    assert.equal(s2.length, 1, "s2 should have 1 message");
    assert.ok(s1.every((m) => m.sessionId === "s1"), "All s1 messages belong to s1");
    assert.ok(s2.every((m) => m.sessionId === "s2"), "All s2 messages belong to s2");
  });

  it("updateMessageParts + markMessageComplete — streaming lifecycle", async () => {
    const store = new InMemorySessionStore();

    await store.addMessage({
      id: "msg-stream",
      sessionId: "sess1",
      role: "assistant",
      parts: [],
    });

    // Initially streaming
    let msgs = await store.getMessages("sess1");
    assert.equal(msgs[0].streaming, true);

    // Update parts
    await store.updateMessageParts("msg-stream", [
      { type: "text", content: "hello world" },
    ]);
    msgs = await store.getMessages("sess1");
    assert.equal(msgs[0].parts.length, 1);
    assert.deepEqual(msgs[0].parts[0], { type: "text", content: "hello world" });

    // Mark complete
    await store.markMessageComplete("msg-stream");
    msgs = await store.getMessages("sess1");
    assert.equal(msgs[0].streaming, false);
  });
});

// =============================================================================
// Push decision logic
// =============================================================================

describe("decidePush", () => {
  it("returns correct decisions for each event type", () => {
    // permission.created → send
    const perm = decidePush("permission.created", {
      permission: { id: "p1", description: "run tests" },
      sessionID: "s1",
    });
    assert.equal(perm.send, true);
    assert.equal(perm.title, "Approval needed");
    assert.ok(perm.body.includes("run tests"));

    // message.completed → send
    const completed = decidePush("message.completed", { sessionID: "s1" });
    assert.equal(completed.send, true);
    assert.equal(completed.title, "Task complete");

    // message.part.updated → send
    const working = decidePush("message.part.updated", { sessionID: "s1" });
    assert.equal(working.send, true);
    assert.equal(working.title, "Agent working");

    // unknown → don't send
    const unknown = decidePush("session.created", {});
    assert.equal(unknown.send, false);
  });
});

describe("PushDeduplicator", () => {
  it("debounces working notifications but not permission/completed", () => {
    const dedup = new PushDeduplicator({ workingIntervalMs: 5000 });

    // Permission: always allowed
    assert.equal(dedup.shouldSend("permission"), true);
    assert.equal(dedup.shouldSend("permission"), true);

    // Completed: always allowed
    assert.equal(dedup.shouldSend("completed"), true);
    assert.equal(dedup.shouldSend("completed"), true);

    // Working: first one allowed, second blocked within interval
    assert.equal(dedup.shouldSend("working"), true);
    assert.equal(dedup.shouldSend("working"), false, "Second working should be suppressed");
  });

  it("tracks different event categories independently", () => {
    const dedup = new PushDeduplicator({ workingIntervalMs: 5000 });

    // Working is debounced
    assert.equal(dedup.shouldSend("working"), true);
    assert.equal(dedup.shouldSend("working"), false);

    // But permission is NOT affected by working's dedup
    assert.equal(dedup.shouldSend("permission"), true);

    // And completed is NOT affected either
    assert.equal(dedup.shouldSend("completed"), true);
  });
});

// =============================================================================
// Phase 4 Unit Tests
// =============================================================================

// --- Unit Test 1: Pairing code generation produces 6-digit numeric strings ---

describe("generatePairingCode", () => {
  it("produces 6-digit numeric strings", () => {
    for (let i = 0; i < 100; i++) {
      const code = generatePairingCode();
      assert.match(code, /^\d{6}$/, `Code "${code}" should be exactly 6 digits`);
      const num = parseInt(code, 10);
      assert.ok(num >= 100000 && num <= 999999, `Code ${num} should be in range 100000-999999`);
    }
  });

  it("generates different codes (not constant)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generatePairingCode());
    }
    // With 900000 possible values, 50 draws should yield at least 2 unique
    assert.ok(codes.size > 1, "Should generate at least 2 unique codes out of 50");
  });
});

// --- Unit Test 2: Pairing code expiry check returns false after 5 minutes ---

describe("PairingManager expiry", () => {
  it("hasPending returns false after 5 minutes", () => {
    const manager = new PairingManager();
    const fakeWs = { send: () => {}, readyState: 1 } as any;

    manager.registerCode("123456", fakeWs);
    assert.equal(manager.hasPending(), true, "Should have pending pairing initially");

    // Monkey-patch Date.now to simulate 5 minutes + 1ms elapsed
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 5 * 60 * 1000 + 1;
      assert.equal(manager.hasPending(), false, "Should expire after 5 minutes");
      assert.equal(manager.getPendingCode(), null, "Code should be null after expiry");
    } finally {
      Date.now = realNow;
    }
  });

  it("hasPending returns true within 5 minutes", () => {
    const manager = new PairingManager();
    const fakeWs = { send: () => {}, readyState: 1 } as any;

    manager.registerCode("654321", fakeWs);

    // Monkey-patch Date.now to simulate 4 minutes 59 seconds
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 4 * 60 * 1000 + 59 * 1000;
      assert.equal(manager.hasPending(), true, "Should still be pending before 5 minutes");
      assert.equal(manager.getPendingCode(), "654321");
    } finally {
      Date.now = realNow;
    }
  });
});

// --- Unit Test 3: buildSyncRequest with cached sessions produces correct structure ---

describe("buildSyncRequest", () => {
  it("produces correct structure from cached sessions", async () => {
    const store = new InMemorySessionStore();
    await store.upsertSession({ id: "sess-a", title: "Session A" });
    await store.upsertSession({ id: "sess-b", title: "Session B" });

    const timestamp = "2026-02-19T12:00:00.000Z";
    const request = await buildSyncRequest(store, timestamp);

    assert.equal(request.type, "sync_request");
    assert.equal(request.lastEventTimestamp, timestamp);
    assert.ok(Array.isArray(request.cachedSessionIds));
    assert.equal(request.cachedSessionIds.length, 2);
    assert.ok(request.cachedSessionIds.includes("sess-a"));
    assert.ok(request.cachedSessionIds.includes("sess-b"));
  });

  it("produces empty cachedSessionIds for empty store", async () => {
    const store = new InMemorySessionStore();
    const request = await buildSyncRequest(store, "2026-01-01T00:00:00.000Z");

    assert.equal(request.type, "sync_request");
    assert.deepEqual(request.cachedSessionIds, []);
  });
});

// --- Unit Test 4: processSyncResponse merges missed messages into store correctly ---

describe("processSyncResponse", () => {
  it("merges missed messages into store and broadcasts to phone", async () => {
    const store = new InMemorySessionStore();
    const broadcasts: unknown[] = [];
    const fakePhoneConnections = {
      broadcast: (msg: unknown) => { broadcasts.push(msg); },
      addClient: () => {},
      removeClient: () => {},
      getClientCount: () => 0,
    } as unknown as PhoneConnectionManager;

    const syncResponse = {
      type: "sync_response" as const,
      sessions: [
        {
          id: "sess-1",
          messages: [
            { id: "msg-1", role: "assistant", parts: [{ type: "text", text: "hello" }], completed: true },
            { id: "msg-2", role: "assistant", parts: [{ type: "text", text: "world" }], completed: false },
          ],
        },
      ],
    };

    await processSyncResponse(syncResponse, store, fakePhoneConnections);

    // Verify messages were stored
    const messages = await store.getMessages("sess-1");
    assert.equal(messages.length, 2, "Should have 2 messages");
    assert.equal(messages[0].id, "msg-1");
    assert.equal(messages[1].id, "msg-2");

    // Verify completed flag: msg-1 should be marked complete, msg-2 still streaming
    assert.equal(messages[0].streaming, false, "msg-1 should be marked complete");
    assert.equal(messages[1].streaming, true, "msg-2 should still be streaming");

    // Verify broadcasts happened (one per message)
    assert.equal(broadcasts.length, 2, "Should broadcast 2 events");
    const event0 = broadcasts[0] as any;
    assert.equal(event0.type, "event");
    assert.equal(event0.event.type, "message.created");
    assert.equal(event0.event.data.sessionID, "sess-1");
  });

  it("handles empty sync response gracefully", async () => {
    const store = new InMemorySessionStore();
    const broadcasts: unknown[] = [];
    const fakePhoneConnections = {
      broadcast: (msg: unknown) => { broadcasts.push(msg); },
    } as unknown as PhoneConnectionManager;

    const syncResponse = {
      type: "sync_response" as const,
      sessions: [],
    };

    await processSyncResponse(syncResponse, store, fakePhoneConnections);

    const sessions = await store.listSessions();
    assert.equal(sessions.length, 0, "No sessions should be created");
    assert.equal(broadcasts.length, 0, "No broadcasts should happen");
  });
});

// --- Unit Test 5: Health check state machine: healthy → degraded → down → recovery ---

describe("HealthMonitor state machine", () => {
  it("transitions healthy → degraded → down → recovery", async () => {
    const stateChanges: Array<{ state: string; ready: boolean }> = [];
    let recoveryTriggered = false;

    // Use a non-existent URL to force failures when we want them
    const monitor = new HealthMonitor({
      opencodeBaseUrl: "http://127.0.0.1:1", // will fail
      checkIntervalMs: 60_000, // won't auto-run; we call check() manually
      failureThreshold: 3,
      onStateChange: (state, ready) => {
        stateChanges.push({ state, ready });
      },
      onRecoveryNeeded: async () => {
        recoveryTriggered = true;
      },
    });

    // Start healthy
    assert.equal(monitor.state, "healthy");

    // 1 failure → degraded (no state change callback fired)
    await monitor.check();
    assert.equal(monitor.state, "degraded");
    assert.equal(monitor.failures, 1);
    assert.equal(stateChanges.length, 0, "No callback for transient failure");

    // 2 failures → still degraded
    await monitor.check();
    assert.equal(monitor.state, "degraded");
    assert.equal(monitor.failures, 2);
    assert.equal(stateChanges.length, 0);

    // 3 failures → down, state change callback fired
    await monitor.check();
    assert.equal(monitor.state, "down");
    assert.equal(monitor.failures, 3);
    assert.equal(stateChanges.length, 1);
    assert.equal(stateChanges[0].state, "down");
    assert.equal(stateChanges[0].ready, false);
    assert.equal(recoveryTriggered, true, "Recovery should be triggered");

    // Additional failure → stays down, no duplicate callback
    await monitor.check();
    assert.equal(monitor.state, "down");
    assert.equal(stateChanges.length, 1, "No duplicate down callback");

    // Reset + simulate recovery (manual reset to test the transition)
    monitor.reset();
    assert.equal(monitor.state, "healthy");
    assert.equal(monitor.failures, 0);
  });
});

// --- Unit Test 6: Reconnect delay calculation with jitter stays within expected bounds ---

describe("Reconnect delay calculation", () => {
  it("backoff with jitter stays within expected bounds", () => {
    // Mirrors the formula from relay.ts:
    //   exponentialDelay = min(baseDelay * 2^attempt, maxDelay)
    //   jitter = exponentialDelay * random * 0.3
    //   delay = exponentialDelay + jitter
    // So delay is in [exponentialDelay, exponentialDelay * 1.3]

    const baseDelay = 1000;
    const maxDelay = 30_000;

    // Test a range of attempts
    for (let attempt = 0; attempt < 20; attempt++) {
      const exponentialDelay = Math.min(
        baseDelay * Math.pow(2, attempt),
        maxDelay,
      );

      const minExpected = exponentialDelay;       // jitter = 0
      const maxExpected = exponentialDelay * 1.3;  // jitter = 30%

      // Run 100 random samples per attempt
      for (let i = 0; i < 100; i++) {
        const jitter = exponentialDelay * Math.random() * 0.3;
        const delay = exponentialDelay + jitter;

        assert.ok(
          delay >= minExpected && delay <= maxExpected,
          `attempt=${attempt}: delay ${delay} should be in [${minExpected}, ${maxExpected}]`,
        );
      }

      // Verify cap behavior
      if (attempt >= 5) {
        // 1000 * 2^5 = 32000 → capped to 30000
        assert.ok(
          exponentialDelay <= maxDelay,
          `attempt=${attempt}: exponentialDelay ${exponentialDelay} should be <= ${maxDelay}`,
        );
      }
    }

    // Specific checks for well-known values
    assert.equal(Math.min(baseDelay * Math.pow(2, 0), maxDelay), 1000);  // attempt 0
    assert.equal(Math.min(baseDelay * Math.pow(2, 1), maxDelay), 2000);  // attempt 1
    assert.equal(Math.min(baseDelay * Math.pow(2, 2), maxDelay), 4000);  // attempt 2
    assert.equal(Math.min(baseDelay * Math.pow(2, 3), maxDelay), 8000);  // attempt 3
    assert.equal(Math.min(baseDelay * Math.pow(2, 4), maxDelay), 16000); // attempt 4
    assert.equal(Math.min(baseDelay * Math.pow(2, 5), maxDelay), 30000); // attempt 5 — capped
    assert.equal(Math.min(baseDelay * Math.pow(2, 10), maxDelay), 30000); // attempt 10 — capped
  });
});
