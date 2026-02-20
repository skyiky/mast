/**
 * ClaudeCodeAdapter Tests
 *
 * Tests the Claude Code adapter using a fake SDK (no API key needed).
 * Covers lifecycle, session CRUD, message streaming, permission flow, and abort.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code-adapter.js";
import { createFakeClaudeSDK, type FakeClaudeSDK } from "./fake-claude-sdk.js";
import type { MastEvent } from "../src/agent-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect events emitted by the adapter. */
function collectEvents(adapter: ClaudeCodeAdapter): MastEvent[] {
  const events: MastEvent[] = [];
  adapter.events.on("event", (e: MastEvent) => events.push(e));
  return events;
}

/** Wait until a predicate is true, checking every `intervalMs`. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let adapter: ClaudeCodeAdapter | null = null;
let sdk: FakeClaudeSDK;

afterEach(async () => {
  if (adapter) {
    await adapter.stop();
    adapter = null;
  }
});

// =============================================================================
// Lifecycle
// =============================================================================

describe("ClaudeCodeAdapter lifecycle", () => {
  it("start() succeeds in test mode (no API key needed)", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();
    const healthy = await adapter.healthCheck();
    assert.equal(healthy, true);
  });

  it("stop() cleans up sessions and pending permissions", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    // Create a session
    const session = await adapter.createSession();
    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 1);

    await adapter.stop();

    // After stop, health check returns false
    const healthy = await adapter.healthCheck();
    assert.equal(healthy, false);

    adapter = null; // already stopped
  });

  it("healthCheck returns false before start", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    const healthy = await adapter.healthCheck();
    assert.equal(healthy, false);
  });

  it("agentType is 'claude-code'", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    assert.equal(adapter.agentType, "claude-code");
  });
});

// =============================================================================
// Session CRUD
// =============================================================================

describe("ClaudeCodeAdapter sessions", () => {
  it("createSession returns a session with uuid and agentType", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    assert.ok(session.id, "session should have an id");
    assert.equal(session.agentType, "claude-code");
    assert.ok(session.createdAt, "session should have createdAt");
  });

  it("listSessions returns all created sessions", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    await adapter.createSession();
    await adapter.createSession();
    await adapter.createSession();

    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 3);
  });

  it("getMessages throws for unknown session", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    await assert.rejects(
      () => adapter!.getMessages("nonexistent"),
      /Session not found/,
    );
  });
});

// =============================================================================
// Message streaming
// =============================================================================

describe("ClaudeCodeAdapter messaging", () => {
  it("sendPrompt emits message.created, then message.completed on finish", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Hello");

    // Wait for message.created
    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Finish the stream
    sdk.finish();

    // Wait for message.completed
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    const created = events.find((e) => e.type === "mast.message.created")!;
    assert.equal(created.sessionId, session.id);
    assert.ok(created.data.message, "should have message data");

    const completed = events.find((e) => e.type === "mast.message.completed")!;
    assert.equal(completed.sessionId, session.id);
  });

  it("text result message emits message.part.updated", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Say hello");

    // Wait for the stream to start
    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Push a result message from the "SDK"
    sdk.pushMessage({ type: "result", result: "Hello there!" });
    sdk.finish();

    await waitFor(() => events.some((e) => e.type === "mast.message.part.updated"));
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    const partUpdate = events.find((e) => e.type === "mast.message.part.updated")!;
    assert.equal(partUpdate.sessionId, session.id);
    const part = partUpdate.data.part as Record<string, unknown>;
    assert.equal(part.type, "text");
    assert.equal(part.content, "Hello there!");

    // Verify getMessages returns the messages
    const messages = await adapter.getMessages(session.id);
    assert.equal(messages.length, 2); // user + assistant
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");
    assert.equal(messages[1].completed, true);
  });

  it("tool_use message emits message.part.updated with tool info", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Read a file");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    sdk.pushMessage({
      type: "tool_use",
      tool_name: "Read",
      tool_input: { filePath: "/tmp/test.ts" },
      tool_use_id: "tu_123",
    });
    sdk.finish();

    await waitFor(() => events.some((e) => e.type === "mast.message.part.updated"));

    const partUpdate = events.find((e) => e.type === "mast.message.part.updated")!;
    const part = partUpdate.data.part as Record<string, unknown>;
    assert.equal(part.type, "tool-invocation");
    assert.equal(part.toolName, "Read");
    assert.deepEqual(part.input, { filePath: "/tmp/test.ts" });
    assert.equal(part.toolUseId, "tu_123");
  });

  it("system init message captures SDK session ID for resume", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    // First prompt — SDK sends init with session_id
    adapter.sendPrompt(session.id, "Init test");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    sdk.pushMessage({
      type: "system",
      subtype: "init",
      session_id: "sdk-session-abc123",
    });
    sdk.pushMessage({ type: "result", result: "Done" });
    sdk.finish();

    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    // Verify first query had no resume (fresh session)
    const firstOpts = sdk.allQueryOpts()[0];
    assert.equal(firstOpts.prompt, "Init test");
    assert.equal(firstOpts.options?.resume, undefined, "first query should not have resume");

    // Second prompt on the same session — should pass resume: sdkSessionId
    adapter.sendPrompt(session.id, "Follow up");

    await waitFor(() => sdk.allQueryOpts().length === 2);

    const secondOpts = sdk.allQueryOpts()[1];
    assert.equal(secondOpts.prompt, "Follow up");
    assert.equal(secondOpts.options?.resume, "sdk-session-abc123",
      "second query should resume with SDK session ID");

    sdk.finish();
    await waitFor(() =>
      events.filter((e) => e.type === "mast.message.completed").length === 2,
    );
  });

  it("text content block emits message.part.updated", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Think about this");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Push a text content block (different from result — intermediate thinking)
    sdk.pushMessage({ type: "text", content: "Let me think about this..." });
    sdk.finish();

    await waitFor(() => events.some((e) => e.type === "mast.message.part.updated"));
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    const partEvents = events.filter((e) => e.type === "mast.message.part.updated");
    assert.equal(partEvents.length, 1);
    const part = partEvents[0].data.part as Record<string, unknown>;
    assert.equal(part.type, "text");
    assert.equal(part.content, "Let me think about this...");

    // Verify it's stored in messages
    const messages = await adapter.getMessages(session.id);
    const assistant = messages.find((m) => m.role === "assistant")!;
    assert.equal(assistant.parts.length, 1);
    assert.deepEqual(assistant.parts[0], {
      type: "text",
      content: "Let me think about this...",
    });
  });

  it("query passes configured allowedTools to SDK", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({
      _queryFn: sdk.queryFn,
      allowedTools: ["Read", "Write"],
    });
    await adapter.start();

    const session = await adapter.createSession();
    adapter.sendPrompt(session.id, "test");

    await waitFor(() => sdk.lastQueryOpts() !== null);
    sdk.finish();

    const opts = sdk.lastQueryOpts()!;
    assert.deepEqual(opts.options?.allowedTools, ["Read", "Write"]);
  });

  it("handles init -> tool_use -> text -> result sequence correctly", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Complex task");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Push the full sequence: init -> tool_use -> text -> result
    sdk.pushMessage({
      type: "system",
      subtype: "init",
      session_id: "sdk-seq-123",
    });
    sdk.pushMessage({
      type: "tool_use",
      tool_name: "Read",
      tool_input: { filePath: "/tmp/foo.ts" },
      tool_use_id: "tu_seq_1",
    });
    sdk.pushMessage({
      type: "text",
      content: "I read the file. Now let me explain...",
    });
    sdk.pushMessage({
      type: "result",
      result: "Here is the final answer.",
    });
    sdk.finish();

    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    // Verify events arrived in order
    const partEvents = events.filter((e) => e.type === "mast.message.part.updated");
    assert.equal(partEvents.length, 3, "should have 3 part updates (tool_use, text, result)");

    // Part 0: tool_use
    const p0 = partEvents[0].data.part as Record<string, unknown>;
    assert.equal(p0.type, "tool-invocation");
    assert.equal(p0.toolName, "Read");
    assert.equal(p0.toolUseId, "tu_seq_1");

    // Part 1: text content block
    const p1 = partEvents[1].data.part as Record<string, unknown>;
    assert.equal(p1.type, "text");
    assert.equal(p1.content, "I read the file. Now let me explain...");

    // Part 2: result
    const p2 = partEvents[2].data.part as Record<string, unknown>;
    assert.equal(p2.type, "text");
    assert.equal(p2.content, "Here is the final answer.");

    // Verify stored messages have all parts in order
    const messages = await adapter.getMessages(session.id);
    assert.equal(messages.length, 2, "user + assistant");

    const assistant = messages[1];
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.completed, true);
    assert.equal(assistant.parts.length, 3);

    assert.equal((assistant.parts[0] as any).type, "tool-invocation");
    assert.equal((assistant.parts[1] as any).type, "text");
    assert.equal((assistant.parts[1] as any).content, "I read the file. Now let me explain...");
    assert.equal((assistant.parts[2] as any).type, "text");
    assert.equal((assistant.parts[2] as any).content, "Here is the final answer.");
  });

  it("error during query emits error part and completes", async () => {
    // Create a query function that throws
    const errorQueryFn = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<any>> {
            throw new Error("SDK exploded");
          },
        };
      },
    });

    adapter = new ClaudeCodeAdapter({ _queryFn: errorQueryFn as any });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "boom");

    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    // Should have an error part
    const partEvents = events.filter((e) => e.type === "mast.message.part.updated");
    assert.ok(partEvents.length > 0, "should emit error part");
    const errorPart = partEvents[0].data.part as Record<string, unknown>;
    assert.ok(
      (errorPart.content as string).includes("SDK exploded"),
      "error part should contain error message",
    );
  });

  it("sendPrompt throws if a query is already running", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    // Start a prompt that will block (SDK stream stays open)
    adapter.sendPrompt(session.id, "First prompt");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Second prompt while first is still running — should throw
    assert.throws(
      () => adapter!.sendPrompt(session.id, "Second prompt"),
      /already has a running query/,
    );

    // Clean up — finish the first stream
    sdk.finish();
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    // After first completes, a new prompt should succeed
    adapter.sendPrompt(session.id, "Third prompt (should work)");
    await waitFor(() => sdk.allQueryOpts().length === 2);
    sdk.finish();
    await waitFor(() =>
      events.filter((e) => e.type === "mast.message.completed").length === 2,
    );
  });

  it("sendPrompt throws for unknown session", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    assert.throws(
      () => adapter!.sendPrompt("nonexistent-session", "Hello"),
      /Session not found/,
    );
  });
});

// =============================================================================
// Permission flow
// =============================================================================

describe("ClaudeCodeAdapter permissions", () => {
  it("PreToolUse hook emits permission.created, approve resolves with allow", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Write a file");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Get the PreToolUse hook from the query options
    const hook = sdk.getPreToolUseHook();
    assert.ok(hook, "PreToolUse hook should be registered");

    // Simulate the SDK calling the PreToolUse hook (as it would before a tool call)
    const hookPromise = hook(
      { tool_name: "Write", tool_input: { filePath: "/tmp/out.ts", content: "hi" } },
      "tu_456",
      {},
    );

    // Wait for permission.created event
    await waitFor(() => events.some((e) => e.type === "mast.permission.created"));

    const permEvent = events.find((e) => e.type === "mast.permission.created")!;
    assert.equal(permEvent.sessionId, session.id);
    const permData = permEvent.data.permission as Record<string, unknown>;
    assert.ok(permData.id, "permission should have an id");
    assert.equal(permData.toolName, "Write");

    // Approve the permission
    adapter.approvePermission(session.id, permData.id as string);

    // The hook should resolve with allow
    const hookResult = await hookPromise;
    assert.deepEqual(hookResult, {
      hookSpecificOutput: { permissionDecision: "allow" },
    });

    // Should emit permission.updated
    await waitFor(() => events.some((e) => e.type === "mast.permission.updated"));
    const updatedEvent = events.find((e) => e.type === "mast.permission.updated")!;
    assert.equal(updatedEvent.data.status, "approved");

    sdk.finish();
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));
  });

  it("deny resolves PreToolUse hook with deny decision", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Delete everything");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    const hook = sdk.getPreToolUseHook()!;
    const hookPromise = hook(
      { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
      "tu_789",
      {},
    );

    await waitFor(() => events.some((e) => e.type === "mast.permission.created"));

    const permData = events.find((e) => e.type === "mast.permission.created")!
      .data.permission as Record<string, unknown>;

    // Deny the permission
    adapter.denyPermission(session.id, permData.id as string);

    const hookResult = await hookPromise;
    assert.deepEqual(hookResult, {
      hookSpecificOutput: { permissionDecision: "deny" },
    });

    // permission.updated should show denied
    await waitFor(() => events.some((e) => e.type === "mast.permission.updated"));
    const updatedEvent = events.find((e) => e.type === "mast.permission.updated")!;
    assert.equal(updatedEvent.data.status, "denied");

    sdk.finish();
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));
  });

  it("stop() auto-denies pending permissions", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Do something");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    const hook = sdk.getPreToolUseHook()!;
    const hookPromise = hook(
      { tool_name: "Bash", tool_input: { command: "echo hi" } },
      "tu_auto",
      {},
    );

    await waitFor(() => events.some((e) => e.type === "mast.permission.created"));

    // Stop the adapter without approving — should auto-deny
    await adapter.stop();

    const hookResult = await hookPromise;
    assert.deepEqual(hookResult, {
      hookSpecificOutput: { permissionDecision: "deny" },
    });

    adapter = null; // already stopped
  });

  it("approvePermission with unknown ID is a silent no-op", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    // Approve a permission that doesn't exist — should not throw or emit
    adapter.approvePermission(session.id, "nonexistent-perm-id");

    // Give a tick for any events to fire
    await new Promise((r) => setTimeout(r, 50));

    const permUpdated = events.filter((e) => e.type === "mast.permission.updated");
    assert.equal(permUpdated.length, 0, "should not emit permission.updated for unknown ID");
  });

  it("denyPermission with unknown ID is a silent no-op", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    // Deny a permission that doesn't exist — should not throw or emit
    adapter.denyPermission(session.id, "nonexistent-perm-id");

    // Give a tick for any events to fire
    await new Promise((r) => setTimeout(r, 50));

    const permUpdated = events.filter((e) => e.type === "mast.permission.updated");
    assert.equal(permUpdated.length, 0, "should not emit permission.updated for unknown ID");
  });
});

// =============================================================================
// Abort
// =============================================================================

describe("ClaudeCodeAdapter abort", () => {
  it("abortSession stops the running query", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const events = collectEvents(adapter);

    adapter.sendPrompt(session.id, "Long running task");

    await waitFor(() => events.some((e) => e.type === "mast.message.created"));

    // Abort the session
    await adapter.abortSession(session.id);

    // The stream should end — push a message that won't be consumed
    sdk.pushMessage({ type: "result", result: "Should not appear" });
    sdk.finish();

    // message.completed should still fire (in the finally block)
    await waitFor(() => events.some((e) => e.type === "mast.message.completed"));

    // The "Should not appear" message should NOT be in the parts
    // because the abort signal was set before the message was consumed
    const messages = await adapter.getMessages(session.id);
    const assistant = messages.find((m) => m.role === "assistant")!;
    const textParts = assistant.parts.filter(
      (p: any) => p.type === "text" && p.content === "Should not appear",
    );
    assert.equal(textParts.length, 0, "Aborted query should not process more messages");
  });

  it("abortSession on idle session is a no-op", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();

    // Should not throw
    await adapter.abortSession(session.id);
  });
});

// =============================================================================
// Diff
// =============================================================================

describe("ClaudeCodeAdapter diff", () => {
  it("getDiff returns empty files array (not yet implemented)", async () => {
    sdk = createFakeClaudeSDK();
    adapter = new ClaudeCodeAdapter({ _queryFn: sdk.queryFn });
    await adapter.start();

    const session = await adapter.createSession();
    const diff = await adapter.getDiff(session.id);
    assert.deepEqual(diff, { files: [] });
  });
});
