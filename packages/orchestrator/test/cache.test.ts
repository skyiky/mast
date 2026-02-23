/**
 * Phase 3 Session Cache Tests
 *
 * Tests that messages flowing through the relay are stored in the
 * InMemorySessionStore and can be served when the daemon is offline.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startPhase3Stack,
  apiRequest,
  sleep,
  type Phase3TestStack,
} from "./helpers.js";
import { DEV_USER_ID } from "../src/auth.js";

describe("Session cache", () => {
  let stack: Phase3TestStack;

  before(async () => {
    stack = await startPhase3Stack();
  });

  after(async () => {
    await stack.close();
  });

  // --------------------------------------------------------------------------
  // 1. Messages flowing through relay are captured in session store
  // --------------------------------------------------------------------------

  it("messages flowing through relay are captured in session store", async () => {
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess1",
        message: { id: "msg1", role: "assistant" },
      },
    });

    // Wait for async cache write (fire-and-forget in server.ts)
    await sleep(300);

    const messages = await stack.store.getMessages("sess1");
    assert.ok(messages.length >= 1, `Expected at least 1 message, got ${messages.length}`);
    assert.equal(messages[0].id, "msg1");
    assert.equal(messages[0].role, "assistant");
    assert.equal(messages[0].sessionId, "sess1");

    const session = await stack.store.getSession(DEV_USER_ID, "sess1");
    assert.ok(session, "Session should exist in the store");
    assert.equal(session.id, "sess1");
  });

  // --------------------------------------------------------------------------
  // 2. Store does not return messages from a different session
  // --------------------------------------------------------------------------

  it("store does not return messages from a different session", async () => {
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-a",
        message: { id: "msg-a", role: "assistant" },
      },
    });

    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-b",
        message: { id: "msg-b", role: "assistant" },
      },
    });

    await sleep(300);

    const messagesA = await stack.store.getMessages("sess-a");
    const messagesB = await stack.store.getMessages("sess-b");

    assert.equal(messagesA.length, 1, "sess-a should have exactly 1 message");
    assert.equal(messagesA[0].id, "msg-a");

    assert.equal(messagesB.length, 1, "sess-b should have exactly 1 message");
    assert.equal(messagesB[0].id, "msg-b");
  });

  // --------------------------------------------------------------------------
  // 3. Store captures both user prompts and assistant messages from SSE events
  // --------------------------------------------------------------------------

  it("store captures both user prompts and assistant messages from SSE events", async () => {
    // Register prompt handler so the forward succeeds
    stack.fakeOpenCode.handle("POST", "/session/sess-prompt/prompt_async", {
      status: 204,
      body: null,
    });

    // Send a prompt — the POST /sessions/:id/prompt route caches the user message
    const promptRes = await apiRequest(
      stack.baseUrl,
      "POST",
      "/sessions/sess-prompt/prompt",
      { parts: [{ type: "text", text: "hello" }] },
    );
    assert.equal(promptRes.status, 200);

    // Simulate assistant response via SSE
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-prompt",
        message: { id: "msg-assistant", role: "assistant" },
      },
    });

    await sleep(300);

    const messages = await stack.store.getMessages("sess-prompt");
    assert.ok(
      messages.length >= 2,
      `Expected at least 2 messages (user + assistant), got ${messages.length}`,
    );

    const roles = messages.map((m) => m.role);
    assert.ok(roles.includes("user"), "Should have a user message");
    assert.ok(roles.includes("assistant"), "Should have an assistant message");
  });

  // --------------------------------------------------------------------------
  // 4. New messages arriving via SSE update the store incrementally
  // --------------------------------------------------------------------------

  it("new messages arriving via SSE update the store incrementally", async () => {
    // Create the message
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-inc",
        message: { id: "msg-inc", role: "assistant" },
      },
    });

    await sleep(200);

    // Update the message parts
    stack.fakeOpenCode.pushEvent({
      type: "message.part.updated",
      properties: {
        messageID: "msg-inc",
        part: { type: "text", content: "hello world" },
      },
    });

    await sleep(200);

    // Mark the message as complete
    stack.fakeOpenCode.pushEvent({
      type: "message.completed",
      properties: {
        messageID: "msg-inc",
      },
    });

    await sleep(300);

    const messages = await stack.store.getMessages("sess-inc");
    assert.ok(messages.length >= 1, `Expected at least 1 message, got ${messages.length}`);

    const msg = messages[0];
    assert.ok(
      msg.parts.some(
        (p: unknown) =>
          typeof p === "object" &&
          p !== null &&
          (p as { content?: string }).content === "hello world",
      ),
      `Expected parts to contain "hello world", got ${JSON.stringify(msg.parts)}`,
    );
    assert.equal(msg.streaming, false, "Message should be marked complete (streaming === false)");
  });

  // --------------------------------------------------------------------------
  // 5. GET /sessions/:id/messages returns stored messages when daemon is disconnected
  // --------------------------------------------------------------------------

  it("GET /sessions/:id/messages returns stored messages when daemon is disconnected", async () => {
    // Push an event and wait for cache
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-offline",
        message: { id: "msg-offline", role: "assistant" },
      },
    });

    await sleep(300);

    // Disconnect the daemon relay
    await stack.relay.disconnect();
    await sleep(100);

    // Now GET messages should serve from cache
    const result = await apiRequest(
      stack.baseUrl,
      "GET",
      "/sessions/sess-offline/messages",
    );
    assert.equal(result.status, 200);

    const messages = result.body as Array<{ id: string; role: string }>;
    assert.ok(Array.isArray(messages), "Body should be an array");
    assert.ok(
      messages.some((m) => m.id === "msg-offline"),
      `Expected message "msg-offline" in response, got ${JSON.stringify(messages)}`,
    );

    // Reconnect for subsequent tests
    await stack.relay.connect();
    await sleep(100);
  });

  // --------------------------------------------------------------------------
  // 6. GET /sessions returns stored session list when daemon is disconnected
  // --------------------------------------------------------------------------

  it("GET /sessions returns stored session list when daemon is disconnected", async () => {
    // Push an event so the session is cached
    stack.fakeOpenCode.pushEvent({
      type: "message.created",
      properties: {
        sessionID: "sess-list",
        message: { id: "msg-list", role: "assistant" },
      },
    });

    await sleep(300);

    // Disconnect the daemon relay
    await stack.relay.disconnect();
    await sleep(100);

    // Now GET sessions should serve from cache
    const result = await apiRequest(stack.baseUrl, "GET", "/sessions");
    assert.equal(result.status, 200);

    const sessions = result.body as Array<{ id: string }>;
    assert.ok(Array.isArray(sessions), "Body should be an array");
    assert.ok(
      sessions.some((s) => s.id === "sess-list"),
      `Expected session "sess-list" in response, got ${JSON.stringify(sessions)}`,
    );

    // Reconnect for any tests that may follow
    await stack.relay.connect();
    await sleep(100);
  });
});
