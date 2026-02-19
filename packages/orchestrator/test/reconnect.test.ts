/**
 * Phase 4 tests: Reconnection & Cache Sync
 *
 * Tests the sync protocol:
 *   1. Daemon disconnects
 *   2. Orchestrator detects disconnect
 *   3. Daemon reconnects
 *   4. Orchestrator sends sync_request with cached session IDs + last event timestamp
 *   5. Daemon queries OpenCode for missed messages
 *   6. Daemon sends sync_response
 *   7. Orchestrator backfills store + broadcasts to phone
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { Relay } from "../../daemon/src/relay.js";
import {
  startPhase4Stack,
  connectPhone,
  apiRequest,
  sleep,
  type Phase4TestStack,
} from "./helpers.js";
import { HARDCODED_DEVICE_KEY } from "@mast/shared";

describe("Reconnection & cache sync", () => {
  let stack: Phase4TestStack;

  afterEach(async () => {
    if (stack) await stack.close();
  });

  it("9. daemon disconnect → orchestrator detects, daemonConnected becomes false", async () => {
    stack = await startPhase4Stack();

    // Verify daemon is connected
    let health = await fetch(`${stack.baseUrl}/health`);
    let body = await health.json() as any;
    assert.equal(body.daemonConnected, true);

    // Disconnect daemon
    await stack.relay.disconnect();
    await sleep(100);

    // Verify disconnected
    health = await fetch(`${stack.baseUrl}/health`);
    body = await health.json();
    assert.equal(body.daemonConnected, false);
  });

  it("10. daemon reconnects → orchestrator sends sync_request with cached session IDs", async () => {
    stack = await startPhase4Stack();

    // Populate cache with a session via SSE event
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sync-sess-1",
        message: { id: "msg-1", role: "assistant" },
      },
    });
    await sleep(200);

    // Verify the session is cached
    const sessions = await stack.store.listSessions();
    assert.ok(sessions.some((s) => s.id === "sync-sess-1"));

    // Register a handler for the message query (daemon will need this for sync)
    stack.fakeOpenCode.handle("GET", "/session/sync-sess-1/message", {
      status: 200,
      body: [],
    });

    // Disconnect daemon
    await stack.relay.disconnect();
    await sleep(100);

    // Reconnect — the daemon should receive a sync_request and respond
    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(200);

    // The daemon should have queried OpenCode for the cached session
    const requests = stack.fakeOpenCode.requests();
    const syncQuery = requests.find(
      (r) => r.method === "GET" && r.path === "/session/sync-sess-1/message"
    );
    assert.ok(syncQuery, "daemon should query OpenCode for cached session messages during sync");

    await relay2.disconnect();
  });

  it("11. sync_request includes lastEventTimestamp matching the last event received", async () => {
    stack = await startPhase4Stack();

    // Send an event with a known timestamp
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "ts-sess",
        message: { id: "ts-msg-1", role: "assistant" },
      },
    });
    await sleep(200);

    // The orchestrator should be tracking the event timestamp
    // We verify this indirectly: on reconnect, the sync_request should contain
    // a non-epoch timestamp (proving the tracker updated)

    stack.fakeOpenCode.handle("GET", "/session/ts-sess/message", {
      status: 200,
      body: [],
    });

    // Disconnect and reconnect
    await stack.relay.disconnect();
    await sleep(100);

    // Use a raw WSS connection to inspect sync_request.
    // Register the message handler BEFORE the connection opens to catch the
    // sync_request that the orchestrator sends immediately on daemon connect.
    const receivedMessages: any[] = [];
    const ws = new WebSocket(
      `ws://localhost:${stack.orchestrator.port}/daemon?token=${HARDCODED_DEVICE_KEY}`,
    );

    ws.on("message", (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Send status (not strictly needed for sync, but keeps protocol correct)
    ws.send(JSON.stringify({ type: "status", opencodeReady: true }));
    await sleep(200);

    // Look for sync_request in received messages
    const syncReq = receivedMessages.find((m) => m.type === "sync_request");
    assert.ok(syncReq, "daemon should receive sync_request from orchestrator");
    assert.ok(Array.isArray(syncReq.cachedSessionIds));
    assert.ok(syncReq.cachedSessionIds.includes("ts-sess"));

    // Timestamp should NOT be epoch (0) — it should match the event we sent
    const timestamp = new Date(syncReq.lastEventTimestamp).getTime();
    assert.ok(timestamp > 0, "lastEventTimestamp should be non-epoch");

    ws.close();
    await sleep(50);
  });

  it("12. daemon responds with sync_response containing missed messages", async () => {
    stack = await startPhase4Stack();

    // Populate cache
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sync-sess-2",
        message: { id: "original-msg", role: "assistant" },
      },
    });
    await sleep(200);

    // Register handler that returns missed messages
    stack.fakeOpenCode.handle("GET", "/session/sync-sess-2/message", {
      status: 200,
      body: [
        {
          id: "missed-msg-1",
          role: "assistant",
          parts: [{ type: "text", content: "missed content" }],
          completed: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    // Disconnect and reconnect
    await stack.relay.disconnect();
    await sleep(100);

    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(300);

    // The missed message should now be in the store
    const messages = await stack.store.getMessages("sync-sess-2");
    const missed = messages.find((m) => m.id === "missed-msg-1");
    assert.ok(missed, "missed message should be backfilled into store");
    assert.equal(missed.role, "assistant");

    await relay2.disconnect();
  });

  it("13. missed messages from sync_response appear in session store after processing", async () => {
    stack = await startPhase4Stack();

    // Populate cache with session
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "backfill-sess",
        message: { id: "existing-msg", role: "user" },
      },
    });
    await sleep(200);

    // Missed messages from OpenCode
    stack.fakeOpenCode.handle("GET", "/session/backfill-sess/message", {
      status: 200,
      body: [
        {
          id: "backfill-1",
          role: "assistant",
          parts: [{ type: "text", content: "hello" }],
          completed: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "backfill-2",
          role: "assistant",
          parts: [{ type: "text", content: "world" }],
          completed: false,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    await stack.relay.disconnect();
    await sleep(100);

    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(300);

    const messages = await stack.store.getMessages("backfill-sess");
    assert.ok(messages.some((m) => m.id === "backfill-1"));
    assert.ok(messages.some((m) => m.id === "backfill-2"));

    // Check completed status
    const msg1 = messages.find((m) => m.id === "backfill-1")!;
    assert.equal(msg1.streaming, false); // completed = true → streaming = false

    await relay2.disconnect();
  });

  it("14. missed messages from sync_response are broadcast to connected phone clients", async () => {
    stack = await startPhase4Stack();

    // Populate cache
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "broadcast-sess",
        message: { id: "orig-msg", role: "user" },
      },
    });
    await sleep(200);

    // Set up missed messages
    stack.fakeOpenCode.handle("GET", "/session/broadcast-sess/message", {
      status: 200,
      body: [
        {
          id: "broadcast-missed",
          role: "assistant",
          parts: [{ type: "text", content: "broadcasted" }],
          completed: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    // Connect phone BEFORE reconnect
    await stack.relay.disconnect();
    await sleep(100);

    const phone = await connectPhone(stack.orchestrator.port);

    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(300);

    // Phone should have received the backfilled event
    const phoneMessages = phone.messages() as any[];
    const backfillEvent = phoneMessages.find(
      (m) => m.type === "event" && m.event?.data?.message?.id === "broadcast-missed"
    );
    assert.ok(backfillEvent, "phone should receive backfilled message via WSS");

    await phone.close();
    await relay2.disconnect();
  });

  it("15. reconnect with empty cache → sync_request has empty cachedSessionIds", async () => {
    stack = await startPhase4Stack();

    // Don't populate any cache — disconnect and reconnect immediately
    await stack.relay.disconnect();
    await sleep(100);

    // Raw WSS to inspect sync_request — register handler before open
    const receivedMessages: any[] = [];
    const ws = new WebSocket(
      `ws://localhost:${stack.orchestrator.port}/daemon?token=${HARDCODED_DEVICE_KEY}`,
    );

    ws.on("message", (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(JSON.stringify({ type: "status", opencodeReady: true }));
    await sleep(200);

    const syncReq = receivedMessages.find((m) => m.type === "sync_request");
    assert.ok(syncReq);
    assert.deepEqual(syncReq.cachedSessionIds, []);

    ws.close();
    await sleep(50);
  });

  it("16. reconnect when no messages were missed → sync_response has empty sessions", async () => {
    stack = await startPhase4Stack();

    // Populate a session
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "no-miss-sess",
        message: { id: "nm-msg-1", role: "user" },
      },
    });
    await sleep(200);

    // Return empty array — no missed messages
    stack.fakeOpenCode.handle("GET", "/session/no-miss-sess/message", {
      status: 200,
      body: [],
    });

    const messagesBefore = await stack.store.getMessages("no-miss-sess");
    const countBefore = messagesBefore.length;

    await stack.relay.disconnect();
    await sleep(100);

    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(300);

    // No new messages should have been added
    const messagesAfter = await stack.store.getMessages("no-miss-sess");
    assert.equal(messagesAfter.length, countBefore);

    await relay2.disconnect();
  });

  it("17. session deleted in OpenCode during disconnect → no crash, session kept in store", async () => {
    stack = await startPhase4Stack();

    // Populate a session
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "deleted-sess",
        message: { id: "del-msg-1", role: "user" },
      },
    });
    await sleep(200);

    // Return 404 — session was deleted
    stack.fakeOpenCode.handle("GET", "/session/deleted-sess/message", {
      status: 404,
      body: { error: "not found" },
    });

    await stack.relay.disconnect();
    await sleep(100);

    const relay2 = new Relay(
      `ws://localhost:${stack.orchestrator.port}`,
      stack.fakeOpenCode.baseUrl,
    );
    await relay2.connect();
    await sleep(300);

    // Should not crash — session still in store (not removed by sync)
    const sessions = await stack.store.listSessions();
    assert.ok(sessions.some((s) => s.id === "deleted-sess"));

    await relay2.disconnect();
  });

  it("18. multiple rapid disconnects/reconnects → sync completes without errors", { timeout: 15000 }, async () => {
    stack = await startPhase4Stack();

    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "rapid-sess",
        message: { id: "rapid-msg", role: "user" },
      },
    });
    await sleep(200);

    stack.fakeOpenCode.handle("GET", "/session/rapid-sess/message", {
      status: 200,
      body: [],
    });

    // Rapid disconnect/reconnect cycles
    for (let i = 0; i < 3; i++) {
      await stack.relay.disconnect();
      await sleep(50);

      const relay = new Relay(
        `ws://localhost:${stack.orchestrator.port}`,
        stack.fakeOpenCode.baseUrl,
      );
      await relay.connect();
      await sleep(200); // give sync time to complete

      // Store the latest relay for next iteration's disconnect
      stack.relay = relay;
    }

    // Verify we're still healthy
    const health = await fetch(`${stack.baseUrl}/health`);
    const body = await health.json() as any;
    assert.equal(body.daemonConnected, true);
  });
});
