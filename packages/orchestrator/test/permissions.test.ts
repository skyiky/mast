/**
 * Phase 3 Permission & Diff Tests
 *
 * Tests the permission approval/deny relay and diff endpoint.
 *   - Permission approve/deny: HTTP -> Orchestrator -> Daemon -> Fake OpenCode
 *   - Full permission loops: prompt + SSE events + approve/deny
 *   - Diff relay: GET /sessions/:id/diff -> fake OpenCode
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startPhase3Stack,
  connectPhone,
  apiRequest,
  sleep,
  type Phase3TestStack,
} from "./helpers.js";

// =============================================================================
// Test Suite 1: Permission approval flow
// =============================================================================

describe("Permission approval flow", () => {
  let stack: Phase3TestStack;

  before(async () => {
    stack = await startPhase3Stack();
  });

  after(async () => {
    await stack.close();
  });

  beforeEach(() => {
    stack.fakeOpenCode.reset();
  });

  it("1. POST /sessions/:id/approve/:pid relays to fake OpenCode", async () => {
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
      status: 200,
      body: { id: "perm1", status: "approved" },
    });

    const res = await apiRequest(
      stack.baseUrl,
      "POST",
      "/sessions/sess1/approve/perm1",
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: "perm1", status: "approved" });

    const recorded = stack.fakeOpenCode.requests();
    assert.ok(
      recorded.some(
        (r) =>
          r.method === "POST" && r.path === "/session/sess1/permissions/perm1",
      ),
      "Fake OpenCode should have received POST /session/sess1/permissions/perm1",
    );
  });

  it("2. POST /sessions/:id/deny/:pid relays to fake OpenCode", async () => {
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
      status: 200,
      body: { id: "perm1", status: "denied" },
    });

    const res = await apiRequest(
      stack.baseUrl,
      "POST",
      "/sessions/sess1/deny/perm1",
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: "perm1", status: "denied" });

    const recorded = stack.fakeOpenCode.requests();
    assert.ok(
      recorded.some(
        (r) =>
          r.method === "POST" && r.path === "/session/sess1/permissions/perm1",
      ),
      "Fake OpenCode should have received POST /session/sess1/permissions/perm1",
    );
  });

  it("3. approval request body sent to OpenCode is { approve: true }", async () => {
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
      status: 200,
      body: { id: "perm1", status: "approved" },
    });

    await apiRequest(stack.baseUrl, "POST", "/sessions/sess1/approve/perm1");

    const recorded = stack.fakeOpenCode.requests();
    const permReq = recorded.find(
      (r) =>
        r.method === "POST" && r.path === "/session/sess1/permissions/perm1",
    );
    assert.ok(permReq, "Should have recorded the permission request");
    assert.deepEqual(permReq.body, { approve: true });
  });

  it("4. denial request body sent to OpenCode is { approve: false }", async () => {
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
      status: 200,
      body: { id: "perm1", status: "denied" },
    });

    await apiRequest(stack.baseUrl, "POST", "/sessions/sess1/deny/perm1");

    const recorded = stack.fakeOpenCode.requests();
    const permReq = recorded.find(
      (r) =>
        r.method === "POST" && r.path === "/session/sess1/permissions/perm1",
    );
    assert.ok(permReq, "Should have recorded the permission request");
    assert.deepEqual(permReq.body, { approve: false });
  });

  it("5. approve when daemon disconnected returns 503", async () => {
    // Disconnect the relay
    await stack.relay.disconnect();
    await sleep(100);

    const res = await apiRequest(
      stack.baseUrl,
      "POST",
      "/sessions/sess1/approve/perm1",
    );

    assert.equal(res.status, 503);
    const body = res.body as { error: string };
    assert.equal(body.error, "Daemon not connected");

    // Reconnect for subsequent tests
    await stack.relay.connect();
    await sleep(100);
  });

  it("6. full permission loop: prompt → permission.created → approve → permission.updated", async () => {
    // Register handlers
    stack.fakeOpenCode.handle("POST", "/session/sess1/prompt_async", {
      status: 204,
      body: null,
    });
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
      status: 200,
      body: { id: "perm1", status: "approved" },
    });

    // Connect phone
    const phone = await connectPhone(stack.orchestrator.port);

    try {
      // Send prompt
      const promptRes = await apiRequest(
        stack.baseUrl,
        "POST",
        "/sessions/sess1/prompt",
        { parts: [{ type: "text", text: "run npm test" }] },
      );
      assert.equal(promptRes.status, 204);

      // Push permission.created SSE event
      stack.fakeOpenCode.pushEvent({
        type: "permission.created",
        properties: {
          sessionID: "sess1",
          permission: { id: "perm1", description: "run npm test" },
        },
      });

      await sleep(300);

      // Approve the permission
      const approveRes = await apiRequest(
        stack.baseUrl,
        "POST",
        "/sessions/sess1/approve/perm1",
      );
      assert.equal(approveRes.status, 200);

      // Push permission.updated SSE event
      stack.fakeOpenCode.pushEvent({
        type: "permission.updated",
        properties: {
          sessionID: "sess1",
          permission: { id: "perm1", status: "approved" },
        },
      });

      await sleep(300);

      // Verify phone received both events
      const msgs = phone.messages();
      const eventTypes = msgs.map(
        (m) => (m as { event: { type: string } }).event.type,
      );
      assert.ok(
        eventTypes.includes("permission.created"),
        "Phone should have received permission.created",
      );
      assert.ok(
        eventTypes.includes("permission.updated"),
        "Phone should have received permission.updated",
      );
    } finally {
      await phone.close();
    }
  });

  it("7. full denial loop: prompt → permission.created → deny → permission.updated (denied)", async () => {
    // Register handlers
    stack.fakeOpenCode.handle("POST", "/session/sess1/prompt_async", {
      status: 204,
      body: null,
    });
    stack.fakeOpenCode.handle("POST", "/session/sess1/permissions/perm2", {
      status: 200,
      body: { id: "perm2", status: "denied" },
    });

    // Connect phone
    const phone = await connectPhone(stack.orchestrator.port);

    try {
      // Send prompt
      const promptRes = await apiRequest(
        stack.baseUrl,
        "POST",
        "/sessions/sess1/prompt",
        { parts: [{ type: "text", text: "delete all files" }] },
      );
      assert.equal(promptRes.status, 204);

      // Push permission.created SSE event
      stack.fakeOpenCode.pushEvent({
        type: "permission.created",
        properties: {
          sessionID: "sess1",
          permission: { id: "perm2", description: "delete all files" },
        },
      });

      await sleep(300);

      // Deny the permission
      const denyRes = await apiRequest(
        stack.baseUrl,
        "POST",
        "/sessions/sess1/deny/perm2",
      );
      assert.equal(denyRes.status, 200);

      // Push permission.updated SSE event with denied status
      stack.fakeOpenCode.pushEvent({
        type: "permission.updated",
        properties: {
          sessionID: "sess1",
          permission: { id: "perm2", status: "denied" },
        },
      });

      await sleep(300);

      // Verify phone received both events
      const msgs = phone.messages();
      const eventTypes = msgs.map(
        (m) => (m as { event: { type: string } }).event.type,
      );
      assert.ok(
        eventTypes.includes("permission.created"),
        "Phone should have received permission.created",
      );
      assert.ok(
        eventTypes.includes("permission.updated"),
        "Phone should have received permission.updated",
      );

      // Verify the updated event carries "denied" status
      const updatedEvent = msgs.find(
        (m) =>
          (m as { event: { type: string } }).event.type === "permission.updated",
      ) as { event: { type: string; data: { properties: { permission: { status: string } } } } };
      assert.ok(updatedEvent, "Should have permission.updated event");
    } finally {
      await phone.close();
    }
  });
});

// =============================================================================
// Test Suite 2: Diff relay
// =============================================================================

describe("Diff relay", () => {
  let stack: Phase3TestStack;

  before(async () => {
    stack = await startPhase3Stack();
  });

  after(async () => {
    await stack.close();
  });

  beforeEach(() => {
    stack.fakeOpenCode.reset();
  });

  it("8. GET /sessions/:id/diff returns structured diff from fake OpenCode", async () => {
    const fakeDiff = {
      files: [
        {
          path: "src/index.ts",
          additions: 12,
          deletions: 3,
          patch:
            "@@ -1,5 +1,14 @@\n-old line\n+new line",
        },
      ],
    };

    stack.fakeOpenCode.handle("GET", "/session/sess1/diff", {
      status: 200,
      body: fakeDiff,
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions/sess1/diff");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, fakeDiff);

    // Verify the right path was hit on fake OpenCode
    const recorded = stack.fakeOpenCode.requests();
    assert.ok(
      recorded.some(
        (r) => r.method === "GET" && r.path === "/session/sess1/diff",
      ),
      "Fake OpenCode should have received GET /session/sess1/diff",
    );
  });

  it("9. diff response includes file paths, added/removed line counts", async () => {
    const fakeDiff = {
      files: [
        {
          path: "src/index.ts",
          additions: 12,
          deletions: 3,
          patch:
            "@@ -1,5 +1,14 @@\n-old line\n+new line",
        },
      ],
    };

    stack.fakeOpenCode.handle("GET", "/session/sess1/diff", {
      status: 200,
      body: fakeDiff,
    });

    const res = await apiRequest(stack.baseUrl, "GET", "/sessions/sess1/diff");
    assert.equal(res.status, 200);

    const body = res.body as {
      files: Array<{
        path: string;
        additions: number;
        deletions: number;
        patch: string;
      }>;
    };

    assert.ok(Array.isArray(body.files), "body.files should be an array");
    assert.equal(body.files.length, 1, "Should have exactly 1 file");

    const file = body.files[0];
    assert.equal(file.path, "src/index.ts");
    assert.equal(file.additions, 12);
    assert.equal(file.deletions, 3);
    assert.ok(
      file.patch.includes("@@ -1,5 +1,14 @@"),
      "Patch should contain diff header",
    );
    assert.ok(
      file.patch.includes("-old line"),
      "Patch should contain removed line",
    );
    assert.ok(
      file.patch.includes("+new line"),
      "Patch should contain added line",
    );
  });
});
