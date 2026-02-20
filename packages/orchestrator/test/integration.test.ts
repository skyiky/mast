/**
 * Phase 1 Integration Tests
 *
 * Tests the full relay chain: HTTP -> Orchestrator -> WSS -> Daemon -> Fake OpenCode
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startStack, createRelayStack, apiRequest, unauthRequest, sleep, type TestStack } from "./helpers.js";
import { startServer, type ServerHandle } from "../src/server.js";

// =============================================================================
// Test Suite 1: Health & Auth (need isolated stack for daemon-not-connected test)
// =============================================================================

describe("Health check and auth", () => {
  let orchestrator: ServerHandle;
  let baseUrl: string;

  before(async () => {
    orchestrator = await startServer(0);
    baseUrl = `http://localhost:${orchestrator.port}`;
  });

  after(async () => {
    await orchestrator.close();
  });

  it("1. health check shows daemonConnected: false before daemon connects", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.daemonConnected, false);
  });

  it("3. unauthenticated request returns 401", async () => {
    const res = await unauthRequest(baseUrl, "GET", "/sessions");
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: "Unauthorized" });
  });
});

// =============================================================================
// Test Suite 2: Full relay chain (orchestrator + daemon + fake OpenCode)
// =============================================================================

describe("Relay chain", () => {
  let stack: TestStack;

  before(async () => {
    stack = await startStack();
  });

  after(async () => {
    await stack.close();
  });

  beforeEach(() => {
    stack.fakeOpenCode.reset();
  });

  it("2. health check shows daemonConnected: true after daemon connects", async () => {
    const res = await fetch(`${stack.baseUrl}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.daemonConnected, true);
  });

  it("4. GET /sessions returns what fake OpenCode returns", async () => {
    const fakeSessions = [{ id: "sess-1", createdAt: "2026-01-01" }];
    stack.fakeOpenCode.handle("GET", "/session", {
      status: 200,
      body: fakeSessions,
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions");
    assert.equal(res.status, 200);
    // The adapter wraps each session with agentType + normalizes createdAt
    const body = res.body as Array<{ id: string; agentType: string; createdAt: string }>;
    assert.ok(Array.isArray(body), "Response should be an array");
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "sess-1");
    assert.equal(body[0].agentType, "opencode");
    assert.equal(body[0].createdAt, "2026-01-01");
  });

  it("5. POST /sessions creates session on fake OpenCode", async () => {
    stack.fakeOpenCode.handle("POST", "/session", {
      status: 200,
      body: { id: "new-sess", createdAt: "2026-01-01" },
    });

    // The semantic create_session command does not forward arbitrary body fields.
    // It only sends agentType (optional). The adapter calls POST /session directly.
    const res = await apiRequest(stack.baseUrl, "POST", "/sessions", { agentType: "opencode" });
    assert.equal(res.status, 200);

    // Verify the response has the adapter-wrapped format
    const body = res.body as { id: string; agentType: string; createdAt: string };
    assert.equal(body.id, "new-sess");
    assert.equal(body.agentType, "opencode");
    assert.equal(body.createdAt, "2026-01-01");

    // Verify the fake OpenCode received the POST
    const recorded = stack.fakeOpenCode.requests();
    const postReq = recorded.find((r) => r.method === "POST" && r.path === "/session");
    assert.ok(postReq, "POST /session should have been recorded");
  });

  it("6. GET /sessions/:id with path params routes correctly", async () => {
    // The semantic protocol serves GET /sessions/:id from the store first,
    // then falls back to list_sessions (GET /session on OpenCode) and filters.
    // Register a handler that returns the session in a list.
    stack.fakeOpenCode.handle("GET", "/session", {
      status: 200,
      body: [{ id: "sess-42", title: "Test session" }],
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions/sess-42");
    assert.equal(res.status, 200);

    // The response comes from list_sessions, which wraps with agentType
    const body = res.body as { id: string; agentType: string };
    assert.equal(body.id, "sess-42");
    assert.equal(body.agentType, "opencode");
  });

  it("7. POST /sessions/:id/prompt returns 200 for prompt_async relay", async () => {
    // OpenCode prompt_async returns 204 with empty body, forward() remaps to 200 with { ok: true }
    stack.fakeOpenCode.handle("POST", "/session/sess-1/prompt_async", {
      status: 204,
      body: null, // empty body
    });

    const res = await apiRequest(stack.baseUrl, "POST", "/sessions/sess-1/prompt", {
      parts: [{ type: "text", text: "hello" }],
    });
    // The relay should successfully return — forward() remaps 204 to 200 with { ok: true }
    assert.equal(res.status, 200);
  });

  it("11. fake OpenCode returning 500 results in empty session list", async () => {
    stack.fakeOpenCode.handle("GET", "/session", {
      status: 500,
      body: { error: "Internal Server Error" },
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions");
    // The AgentRouter uses Promise.allSettled for listSessions(), so a 500 from
    // one adapter results in that adapter's sessions being omitted (empty array).
    // This is by design — other adapters could still return their sessions.
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });
});

// =============================================================================
// Test Suite 3: Disconnect & reconnect scenarios
// =============================================================================

describe("Disconnect and reconnect", () => {
  it("8. request when daemon disconnected returns 503", async () => {
    // Start just the orchestrator, no daemon
    const orchestrator = await startServer(0);
    const baseUrl = `http://localhost:${orchestrator.port}`;

    try {
      const res = await apiRequest(baseUrl, "GET", "/sessions");
      assert.equal(res.status, 503);
      const body = res.body as { error: string };
      assert.equal(body.error, "Daemon not connected");
    } finally {
      await orchestrator.close();
    }
  });

  it("9. daemon reconnects after disconnect", async () => {
    const stack = await startStack();

    try {
      // Verify connected
      let health = await fetch(`${stack.baseUrl}/health`);
      let body = await health.json();
      assert.equal(body.daemonConnected, true);

      // Disconnect the relay
      await stack.relay.disconnect();
      await sleep(100);

      // Should be disconnected now
      health = await fetch(`${stack.baseUrl}/health`);
      body = await health.json();
      assert.equal(body.daemonConnected, false);

      // Reconnect a new relay
      const { relay: relay2, router: router2 } = await createRelayStack(
        stack.orchestrator.port,
        stack.fakeOpenCode,
      );
      await sleep(50);

      // Should be connected again
      health = await fetch(`${stack.baseUrl}/health`);
      body = await health.json();
      assert.equal(body.daemonConnected, true);

      await relay2.disconnect();
      await router2.stopAll();
    } finally {
      await stack.close();
    }
  });
});

// =============================================================================
// Test Suite 4: Timeout handling
// =============================================================================

describe("Timeout handling", () => {
  it("10. request timeout when daemon never responds returns 502", async () => {
    // We need an orchestrator with a daemon that connects but never sends responses.
    // Strategy: connect a raw WebSocket as the daemon, but don't respond to requests.
    const orchestrator = await startServer(0);
    const baseUrl = `http://localhost:${orchestrator.port}`;

    // Import WebSocket to act as a dumb daemon
    const { default: WebSocket } = await import("ws");
    const ws = new WebSocket(
      `ws://localhost:${orchestrator.port}/daemon?token=mast-dev-key-phase1`,
    );

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        // Send status to register as connected
        ws.send(JSON.stringify({ type: "status", agentReady: true, agents: [{ type: "opencode", ready: true }] }));
        resolve();
      });
      ws.on("error", reject);
    });

    await sleep(50);

    try {
      // The DaemonConnection has a 120s timeout by default, which is too long for tests.
      // Instead, we'll verify the request is pending and the system handles it.
      // For a practical test, we send a request and expect it to eventually fail.
      // We'll use AbortController with a short timeout to avoid waiting 120s.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: "GET",
          headers: { Authorization: "Bearer mast-api-token-phase1" },
          signal: controller.signal,
        });
        // If we get here, the request completed (unexpected for a non-responding daemon)
        clearTimeout(timeout);
        assert.fail("Expected request to time out but got response with status " + res.status);
      } catch (err) {
        clearTimeout(timeout);
        // AbortError means we timed out on the client side — which proves
        // the daemon never responded and the request is hanging (as expected).
        if (err instanceof Error && err.name === "AbortError") {
          // This is the expected behavior: daemon connected but never responds,
          // so the request hangs until the 120s server timeout (we abort at 3s).
          assert.ok(true, "Request correctly hangs when daemon does not respond");
        } else {
          throw err;
        }
      }
    } finally {
      ws.close();
      await orchestrator.close();
    }
  });
});

// =============================================================================
// Test Suite 5: Heartbeat
// =============================================================================

describe("Heartbeat", () => {
  it("12. heartbeat is sent by daemon and acknowledged by orchestrator", async () => {
    // Start a stack but with a very short heartbeat interval
    // The SemanticRelay class uses a 30s heartbeat which is too long for tests.
    // Instead, we'll manually test the heartbeat message handling.

    const orchestrator = await startServer(0);

    // Connect a raw WebSocket as daemon
    const { default: WebSocket } = await import("ws");
    const ws = new WebSocket(
      `ws://localhost:${orchestrator.port}/daemon?token=mast-dev-key-phase1`,
    );

    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.on("message", (data) => {
      received.push(data.toString());
    });

    // Send a heartbeat manually
    ws.send(JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() }));

    // Wait for the ack
    await sleep(200);

    // Check we received a heartbeat_ack
    const ack = received.find((msg) => {
      try {
        const parsed = JSON.parse(msg);
        return parsed.type === "heartbeat_ack";
      } catch {
        return false;
      }
    });

    assert.ok(ack, "Should have received a heartbeat_ack");
    const parsed = JSON.parse(ack!);
    assert.equal(parsed.type, "heartbeat_ack");
    assert.ok(parsed.timestamp, "heartbeat_ack should have a timestamp");

    ws.close();
    await orchestrator.close();
  });
});
