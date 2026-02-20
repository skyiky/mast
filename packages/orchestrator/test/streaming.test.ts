/**
 * Phase 2 Streaming Integration Tests
 *
 * Tests the event streaming chain:
 *   Fake OpenCode (SSE) → Daemon → WSS → Orchestrator → Phone WSS
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startStack, connectPhone, apiRequest, sleep, type TestStack } from "./helpers.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { HARDCODED_API_TOKEN } from "@mast/shared";

// =============================================================================
// Test Suite 1: Phone WSS auth
// =============================================================================

describe("Phone WSS connection", () => {
  let orchestrator: ServerHandle;

  before(async () => {
    orchestrator = await startServer(0);
  });

  after(async () => {
    await orchestrator.close();
  });

  it("1. phone WSS connects with valid Bearer token", async () => {
    const ws = new WebSocket(
      `ws://localhost:${orchestrator.port}/ws?token=${HARDCODED_API_TOKEN}`,
    );

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    assert.equal(ws.readyState, WebSocket.OPEN);

    // Health should show 1 phone connected
    const res = await fetch(`http://localhost:${orchestrator.port}/health`);
    const body = await res.json();
    assert.equal(body.phonesConnected, 1);

    ws.close();
    await sleep(50);
  });

  it("2. phone WSS rejected without valid token", async () => {
    const ws = new WebSocket(
      `ws://localhost:${orchestrator.port}/ws?token=wrong-token`,
    );

    const error = await new Promise<Error>((resolve) => {
      ws.on("error", (err) => resolve(err));
    });

    // Connection should fail
    assert.ok(error, "Should receive an error");
  });
});

// =============================================================================
// Test Suite 2: SSE event relay chain
// =============================================================================

describe("SSE event streaming", () => {
  let stack: TestStack;

  before(async () => {
    stack = await startStack();
  });

  after(async () => {
    await stack.close();
  });

  it("3. daemon subscribes to fake OpenCode SSE", async () => {
    // After startStack(), the daemon should have connected its SSE subscriber
    // to the fake OpenCode's /event endpoint
    // Wait a bit for SSE connection to establish
    await sleep(200);
    assert.ok(
      stack.fakeOpenCode.sseClientCount() >= 1,
      `Expected at least 1 SSE client, got ${stack.fakeOpenCode.sseClientCount()}`,
    );
  });

  it("4. SSE event from fake OpenCode arrives on phone WSS", async () => {
    const phone = await connectPhone(stack.orchestrator.port);

    try {
      // Push an SSE event from fake OpenCode
      stack.fakeOpenCode.pushEvent({
        type: "message.created",
        properties: {
          sessionID: "sess-1",
          message: { id: "msg-1", role: "assistant" },
        },
      });

      // Wait for event to propagate through the chain
      await sleep(300);

      const msgs = phone.messages();
      assert.ok(msgs.length >= 1, `Expected at least 1 event, got ${msgs.length}`);

      const event = msgs[0] as { type: string; event: { type: string; data: unknown } };
      assert.equal(event.type, "event");
      assert.equal(event.event.type, "mast.message.created");
    } finally {
      await phone.close();
    }
  });

  it("5. multiple SSE events arrive in order", async () => {
    const phone = await connectPhone(stack.orchestrator.port);

    try {
      // Push 3 events in sequence
      stack.fakeOpenCode.pushEvent({ type: "message.created", order: 1 });
      stack.fakeOpenCode.pushEvent({ type: "message.part.updated", order: 2 });
      stack.fakeOpenCode.pushEvent({ type: "message.completed", order: 3 });

      // Wait for all events to propagate
      await sleep(500);

      const msgs = phone.messages();
      assert.ok(msgs.length >= 3, `Expected at least 3 events, got ${msgs.length}`);

      // Verify ordering
      const events = msgs.slice(-3) as Array<{
        type: string;
        event: { type: string; data: { order: number } };
      }>;
      assert.equal(events[0].event.type, "mast.message.created");
      assert.equal(events[1].event.type, "mast.message.part.updated");
      assert.equal(events[2].event.type, "mast.message.completed");
    } finally {
      await phone.close();
    }
  });

  it("6. send message + receive streamed events (full loop)", async () => {
    const phone = await connectPhone(stack.orchestrator.port);

    try {
      // Set up fake OpenCode to accept the prompt
      stack.fakeOpenCode.handle("POST", "/session/sess-1/prompt_async", {
        status: 204,
        body: null,
      });

      // Send prompt via HTTP
      const promptRes = await apiRequest(
        stack.baseUrl,
        "POST",
        "/sessions/sess-1/prompt",
        { parts: [{ type: "text", text: "hello" }] },
      );
      assert.equal(promptRes.status, 200);

      // Simulate agent responding with SSE events
      stack.fakeOpenCode.pushEvent({
        type: "message.created",
        properties: { sessionID: "sess-1", message: { id: "msg-resp", role: "assistant" } },
      });
      stack.fakeOpenCode.pushEvent({
        type: "message.part.updated",
        properties: { sessionID: "sess-1", part: { type: "text", content: "Hello! I can help" } },
      });
      stack.fakeOpenCode.pushEvent({
        type: "message.completed",
        properties: { sessionID: "sess-1", message: { id: "msg-resp" } },
      });

      await sleep(500);

      const msgs = phone.messages();
      assert.ok(msgs.length >= 3, `Expected at least 3 events, got ${msgs.length}`);

      // Verify we got the full sequence
      const eventTypes = msgs.map(
        (m) => (m as { event: { type: string } }).event.type,
      );
      assert.ok(eventTypes.includes("mast.message.created"), "Should have mast.message.created");
      assert.ok(eventTypes.includes("mast.message.part.updated"), "Should have mast.message.part.updated");
      assert.ok(eventTypes.includes("mast.message.completed"), "Should have mast.message.completed");
    } finally {
      await phone.close();
    }
  });

  it("7. events forwarded even if no phone connected (no crash)", async () => {
    // Wait for any previous phone connections to fully close on server side
    await sleep(200);

    // Push event — should not crash even with 0 phones
    // (phoneConnections.broadcast silently skips if no clients)
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: { sessionID: "sess-1" },
    });

    await sleep(200);

    // If we get here without an error, the test passes
    assert.ok(true, "No crash when broadcasting with no phones connected");
  });

  it("8. phone disconnects and reconnects, receives new events", async () => {
    // Connect first phone
    const phone1 = await connectPhone(stack.orchestrator.port);

    stack.fakeOpenCode.pushEvent({ type: "message.created", properties: { seq: 1 } });
    await sleep(200);

    const msgs1 = phone1.messages();
    assert.ok(msgs1.length >= 1, "Phone 1 should receive event");

    // Disconnect
    await phone1.close();
    await sleep(100);

    // Connect second phone
    const phone2 = await connectPhone(stack.orchestrator.port);

    stack.fakeOpenCode.pushEvent({ type: "message.created", properties: { seq: 2 } });
    await sleep(200);

    const msgs2 = phone2.messages();
    assert.ok(msgs2.length >= 1, "Phone 2 should receive event after reconnect");

    await phone2.close();
  });
});

// =============================================================================
// Test Suite 3: Regression — Phase 1 relay still works
// =============================================================================

describe("Phase 1 regression", () => {
  let stack: TestStack;

  before(async () => {
    stack = await startStack();
  });

  after(async () => {
    await stack.close();
  });

  it("9. GET relay still works alongside streaming", async () => {
    const fakeSessions = [{ id: "sess-1" }];
    stack.fakeOpenCode.handle("GET", "/session", {
      status: 200,
      body: fakeSessions,
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions");
    assert.equal(res.status, 200);
    // The adapter wraps each session with agentType + normalizes createdAt
    const body = res.body as Array<{ id: string; agentType: string }>;
    assert.ok(Array.isArray(body), "Response should be an array");
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "sess-1");
    assert.equal(body[0].agentType, "opencode");
  });
});
