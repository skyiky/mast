/**
 * Unit Tests (Phase 1 + Phase 3)
 *
 * Tests isolated units that can't easily be covered by integration tests.
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateRequestId } from "@mast/shared";
import { DaemonConnection } from "../src/daemon-connection.js";
import { InMemorySessionStore } from "../src/session-store.js";
import { decidePush, PushDeduplicator } from "../src/push-notifications.js";

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
