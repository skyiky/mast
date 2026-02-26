/**
 * Tests for the WebSocket event handler.
 *
 * This is a pure function with no React dependencies,
 * so it can be tested with node:test directly.
 *
 * Run: node --import tsx --test --test-force-exit test/event-handler.test.ts
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  handleWsEvent,
  type EventHandlerDeps,
} from "../src/lib/event-handler.js";

function createMockDeps() {
  return {
    addMessage: mock.fn<EventHandlerDeps["addMessage"]>(),
    updateLastTextPart: mock.fn<EventHandlerDeps["updateLastTextPart"]>(),
    appendTextDelta: mock.fn<EventHandlerDeps["appendTextDelta"]>(),
    addPartToMessage: mock.fn<EventHandlerDeps["addPartToMessage"]>(),
    upsertToolPart: mock.fn<EventHandlerDeps["upsertToolPart"]>(),
    markMessageComplete: mock.fn<EventHandlerDeps["markMessageComplete"]>(),
    addPermission: mock.fn<EventHandlerDeps["addPermission"]>(),
    updatePermission: mock.fn<EventHandlerDeps["updatePermission"]>(),
  };
}

describe("handleWsEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  // ===========================================================================
  // message.updated — PRIMARY path (real OpenCode events)
  // ===========================================================================

  describe("message.updated (OpenCode native)", () => {
    it("adds a new assistant message with streaming=true", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "m1", role: "assistant", sessionID: "s1" },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [sessionId, message] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sessionId, "s1");
      assert.equal(message.id, "m1");
      assert.equal(message.role, "assistant");
      assert.equal(message.streaming, true);
      assert.deepEqual(message.parts, []);
    });

    it("skips user message echoes (added optimistically by handleSend)", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "m2", role: "user", sessionID: "s1" },
        },
      });

      // User messages from SSE are skipped — they were already added
      // optimistically by the chat screen's handleSend function.
      assert.equal(deps.addMessage.mock.calls.length, 0);
    });

    it("marks message complete when finish is set", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: {
            id: "m1",
            role: "assistant",
            sessionID: "s1",
            finish: "stop",
            time: { created: 1234, completed: 5678 },
          },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 1);
      const [sid, mid] = deps.markMessageComplete.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
    });

    it("marks message complete when time.completed is set (no finish field)", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: {
            id: "m1",
            role: "assistant",
            sessionID: "s1",
            time: { completed: 9999 },
          },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 1);
    });

    it("uses sessionId parameter over info.sessionID", () => {
      handleWsEvent(
        deps,
        {
          type: "message.updated",
          data: {
            info: { id: "m1", role: "assistant", sessionID: "from-info" },
          },
        },
        "from-param",
      );

      const [sessionId] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sessionId, "from-param");
    });

    it("ignores event without info payload", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: { sessionID: "s1" },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
    });

    it("ignores event without session ID", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: { info: { id: "m1", role: "assistant" } },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // message.created — LEGACY path (backward compat with test fakes)
  // ===========================================================================

  describe("message.created (legacy)", () => {
    it("adds an assistant message with streaming=true", () => {
      handleWsEvent(
        deps,
        {
          type: "message.created",
          data: {
            sessionID: "s1",
            message: { id: "m1", role: "assistant" },
          },
        },
      );

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [sessionId, message] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sessionId, "s1");
      assert.equal(message.id, "m1");
      assert.equal(message.role, "assistant");
      assert.equal(message.streaming, true);
      assert.deepEqual(message.parts, []);
    });

    it("adds a user message with streaming=false", () => {
      handleWsEvent(
        deps,
        {
          type: "message.created",
          data: {
            sessionID: "s1",
            message: { id: "m2", role: "user" },
          },
        },
      );

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [, message] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(message.streaming, false);
    });

    it("uses sessionId parameter over data.sessionID", () => {
      handleWsEvent(
        deps,
        {
          type: "message.created",
          data: {
            sessionID: "from-data",
            message: { id: "m1", role: "assistant" },
          },
        },
        "from-param",
      );

      const [sessionId] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sessionId, "from-param");
    });

    it("ignores event without message payload", () => {
      handleWsEvent(deps, {
        type: "message.created",
        data: { sessionID: "s1" },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
    });

    it("ignores event without session ID", () => {
      handleWsEvent(deps, {
        type: "message.created",
        data: { message: { id: "m1", role: "assistant" } },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // message.part.updated — handles BOTH OpenCode and legacy data shapes
  // ===========================================================================

  describe("message.part.updated", () => {
    it("updates text part using OpenCode 'text' field", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "text",
            text: "Hello world",
            messageID: "m1",
            sessionID: "s1",
          },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);
      const [sid, mid, text] =
        deps.updateLastTextPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(text, "Hello world");
    });

    it("updates text part using legacy 'content' field", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          sessionID: "s1",
          messageID: "m1",
          part: { type: "text", content: "Hello legacy" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);
      const [sid, mid, text] =
        deps.updateLastTextPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(text, "Hello legacy");
    });

    it("prefers 'text' over 'content' when both are present", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "text",
            text: "from-text",
            content: "from-content",
            messageID: "m1",
            sessionID: "s1",
          },
        },
      });

      const [, , text] = deps.updateLastTextPart.mock.calls[0].arguments;
      assert.equal(text, "from-text");
    });

    it("also handles message.part.created", () => {
      handleWsEvent(deps, {
        type: "message.part.created",
        data: {
          sessionID: "s1",
          messageID: "m1",
          part: { type: "text", content: "Start" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);
    });

    it("ignores non-text parts (step-start)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "step-start",
            messageID: "m1",
            sessionID: "s1",
            snapshot: "some data",
          },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
    });

    it("ignores non-text parts (step-finish)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "step-finish",
            messageID: "m1",
            sessionID: "s1",
            reason: "stop",
          },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
    });

    it("processes tool-invocation parts via addPartToMessage", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          sessionID: "s1",
          messageID: "m1",
          part: { type: "tool-invocation", toolName: "bash", text: "ls -la" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
      assert.equal(deps.addPartToMessage.mock.calls.length, 1);
      const [sid, mid, part] = deps.addPartToMessage.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(part.type, "tool-invocation");
      assert.equal(part.toolName, "bash");
      assert.equal(part.content, "ls -la");
    });

    // -----------------------------------------------------------------------
    // OpenCode v1.x "tool" part type — combines invocation + result in one part
    // -----------------------------------------------------------------------

    it("processes OpenCode tool part (completed, with output)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool1",
            tool: "read",
            callID: "toolu_vrtx_abc123",
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "completed",
              input: { filePath: "/src/index.ts" },
              output: "const x = 1;\n",
              time: { start: 1000, end: 2000 },
            },
          },
        },
      });

      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      assert.equal(deps.addPartToMessage.mock.calls.length, 0);
      const [sid, mid, part] = deps.upsertToolPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(part.type, "tool-invocation");
      assert.equal(part.toolName, "read");
      assert.equal(part.content, "const x = 1;\n");
      assert.equal(part.toolArgs, JSON.stringify({ filePath: "/src/index.ts" }));
      assert.equal(part.callID, "toolu_vrtx_abc123");
    });

    it("processes OpenCode tool part (errored)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool2",
            tool: "bash",
            callID: "toolu_vrtx_def456",
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "error",
              input: { command: "rm -rf /important" },
              error: "Permission denied",
              time: { start: 1000, end: 2000 },
            },
          },
        },
      });

      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      const [sid, mid, part] = deps.upsertToolPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(part.type, "tool-invocation");
      assert.equal(part.toolName, "bash");
      // Error takes priority over output
      assert.equal(part.content, "Permission denied");
      assert.equal(part.toolArgs, JSON.stringify({ command: "rm -rf /important" }));
      assert.equal(part.callID, "toolu_vrtx_def456");
    });

    it("processes OpenCode tool part with no state (pending tool call)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool3",
            tool: "glob",
            callID: "toolu_vrtx_ghi789",
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "running",
              input: { pattern: "**/*.ts" },
            },
          },
        },
      });

      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      const [, , part] = deps.upsertToolPart.mock.calls[0].arguments;
      assert.equal(part.type, "tool-invocation");
      assert.equal(part.toolName, "glob");
      assert.equal(part.content, ""); // No output or error yet
      assert.equal(part.toolArgs, JSON.stringify({ pattern: "**/*.ts" }));
      assert.equal(part.callID, "toolu_vrtx_ghi789");
    });

    it("processes OpenCode tool part with both output and error (error wins)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool4",
            tool: "edit",
            callID: "toolu_vrtx_jkl012",
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "error",
              input: { filePath: "/foo.ts", oldString: "a", newString: "b" },
              output: "partial result",
              error: "oldString not found",
            },
          },
        },
      });

      const [, , part] = deps.upsertToolPart.mock.calls[0].arguments;
      // error takes priority
      assert.equal(part.content, "oldString not found");
    });

    it("processes OpenCode tool part with no input in state", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool5",
            tool: "unknown_tool",
            callID: "toolu_vrtx_mno345",
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "completed",
              output: "done",
            },
          },
        },
      });

      const [, , part] = deps.upsertToolPart.mock.calls[0].arguments;
      assert.equal(part.toolName, "unknown_tool");
      assert.equal(part.content, "done");
      assert.equal(part.toolArgs, undefined); // No input → no args
      assert.equal(part.callID, "toolu_vrtx_mno345");
    });

    it("callID falls back to part.id when callID is missing", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_fallback_id",
            tool: "read",
            // No callID field
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "completed",
              input: { filePath: "/a.ts" },
              output: "content",
            },
          },
        },
      });

      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      const [, , part] = deps.upsertToolPart.mock.calls[0].arguments;
      assert.equal(part.callID, "prt_fallback_id");
    });

    it("multiple lifecycle updates for same callID call upsertToolPart each time", () => {
      const callID = "toolu_vrtx_lifecycle";

      // 1. Pending — no input yet
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_lc1",
            tool: "write",
            callID,
            messageID: "m1",
            sessionID: "s1",
            state: { status: "pending" },
          },
        },
      });
      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      assert.equal(deps.upsertToolPart.mock.calls[0].arguments[2].content, "");
      assert.equal(deps.upsertToolPart.mock.calls[0].arguments[2].callID, callID);

      // 2. Running — input populated
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_lc1",
            tool: "write",
            callID,
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "running",
              input: { filePath: "/a.txt", content: "hello" },
            },
          },
        },
      });
      assert.equal(deps.upsertToolPart.mock.calls.length, 2);
      assert.equal(
        deps.upsertToolPart.mock.calls[1].arguments[2].toolArgs,
        JSON.stringify({ filePath: "/a.txt", content: "hello" }),
      );
      assert.equal(deps.upsertToolPart.mock.calls[1].arguments[2].callID, callID);

      // 3. Completed — output populated
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_lc1",
            tool: "write",
            callID,
            messageID: "m1",
            sessionID: "s1",
            state: {
              status: "completed",
              input: { filePath: "/a.txt", content: "hello" },
              output: "File written successfully",
            },
            time: { start: 1000, end: 2000 },
          },
        },
      });
      assert.equal(deps.upsertToolPart.mock.calls.length, 3);
      assert.equal(
        deps.upsertToolPart.mock.calls[2].arguments[2].content,
        "File written successfully",
      );
      assert.equal(deps.upsertToolPart.mock.calls[2].arguments[2].callID, callID);

      // addPartToMessage should NEVER have been called for tool parts
      assert.equal(deps.addPartToMessage.mock.calls.length, 0);
    });

    it("ignores without messageID", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          sessionID: "s1",
          part: { type: "text", content: "Hello" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
    });

    it("ignores without session ID", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          messageID: "m1",
          part: { type: "text", content: "Hello" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
    });

    it("gets sessionID from part when not on props (OpenCode shape)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          // No top-level sessionID or messageID
          part: {
            type: "text",
            text: "from part",
            messageID: "m1",
            sessionID: "s1",
          },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);
      const [sid, mid, text] =
        deps.updateLastTextPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(text, "from part");
    });
  });

  // ===========================================================================
  // message.part.delta — incremental text streaming
  // ===========================================================================

  describe("message.part.delta", () => {
    it("appends text delta to existing message part", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "text",
          delta: "Hello",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 1);
      const [sid, mid, delta] = deps.appendTextDelta.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(delta, "Hello");
    });

    it("handles multiple consecutive deltas", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "text",
          delta: "Hel",
        },
      });
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "text",
          delta: "lo!",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 2);
      assert.equal(deps.appendTextDelta.mock.calls[0].arguments[2], "Hel");
      assert.equal(deps.appendTextDelta.mock.calls[1].arguments[2], "lo!");
    });

    it("uses sessionId parameter over part.sessionID", () => {
      handleWsEvent(
        deps,
        {
          type: "message.part.delta",
          data: {
            part: { messageID: "m1", sessionID: "from-part" },
            field: "text",
            delta: "X",
          },
        },
        "from-param",
      );

      const [sid] = deps.appendTextDelta.mock.calls[0].arguments;
      assert.equal(sid, "from-param");
    });

    it("reads messageID from props when not on part", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          messageID: "m1",
          sessionID: "s1",
          field: "text",
          delta: "Y",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 1);
      assert.equal(deps.appendTextDelta.mock.calls[0].arguments[1], "m1");
    });

    it("ignores non-text field deltas", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "snapshot",
          delta: "some data",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 0);
    });

    it("ignores delta without messageID", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          sessionID: "s1",
          field: "text",
          delta: "Z",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 0);
    });

    it("ignores delta without sessionID", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1" },
          field: "text",
          delta: "Z",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 0);
    });

    it("ignores empty delta string", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "text",
          delta: "",
        },
      });

      assert.equal(deps.appendTextDelta.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // message.completed — legacy event
  // ===========================================================================

  describe("message.completed (legacy)", () => {
    it("marks message as complete", () => {
      handleWsEvent(deps, {
        type: "message.completed",
        data: { sessionID: "s1", messageID: "m1" },
      });

      assert.equal(deps.markMessageComplete.mock.calls.length, 1);
      const [sid, mid] = deps.markMessageComplete.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
    });

    it("ignores without messageID", () => {
      handleWsEvent(deps, {
        type: "message.completed",
        data: { sessionID: "s1" },
      });

      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
    });

    it("ignores without session ID", () => {
      handleWsEvent(deps, {
        type: "message.completed",
        data: { messageID: "m1" },
      });

      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // permission.created
  // ===========================================================================

  describe("permission.created", () => {
    it("adds pending permission with description", () => {
      handleWsEvent(deps, {
        type: "permission.created",
        data: {
          sessionID: "s1",
          permission: { id: "p1", description: "Allow file write" },
        },
      });

      assert.equal(deps.addPermission.mock.calls.length, 1);
      const [perm] = deps.addPermission.mock.calls[0].arguments;
      assert.equal(perm.id, "p1");
      assert.equal(perm.sessionId, "s1");
      assert.equal(perm.description, "Allow file write");
      assert.equal(perm.status, "pending");
    });

    it("uses default description when missing", () => {
      handleWsEvent(deps, {
        type: "permission.created",
        data: {
          sessionID: "s1",
          permission: { id: "p1" },
        },
      });

      const [perm] = deps.addPermission.mock.calls[0].arguments;
      assert.equal(perm.description, "Permission requested");
    });

    it("ignores without permission payload", () => {
      handleWsEvent(deps, {
        type: "permission.created",
        data: { sessionID: "s1" },
      });

      assert.equal(deps.addPermission.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // permission.updated
  // ===========================================================================

  describe("permission.updated", () => {
    it("updates permission to approved", () => {
      handleWsEvent(deps, {
        type: "permission.updated",
        data: {
          permission: { id: "p1", status: "approved" },
        },
      });

      assert.equal(deps.updatePermission.mock.calls.length, 1);
      const [permId, status] =
        deps.updatePermission.mock.calls[0].arguments;
      assert.equal(permId, "p1");
      assert.equal(status, "approved");
    });

    it("updates permission to denied", () => {
      handleWsEvent(deps, {
        type: "permission.updated",
        data: {
          permission: { id: "p1", status: "denied" },
        },
      });

      const [, status] = deps.updatePermission.mock.calls[0].arguments;
      assert.equal(status, "denied");
    });

    it("ignores without permission payload", () => {
      handleWsEvent(deps, {
        type: "permission.updated",
        data: {},
      });

      assert.equal(deps.updatePermission.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // Properties normalization (OpenCode SSE compat)
  // ===========================================================================

  describe("properties normalization", () => {
    it("reads from properties field when data is absent", () => {
      handleWsEvent(deps, {
        type: "message.created",
        properties: {
          sessionID: "s1",
          message: { id: "m1", role: "assistant" },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [sid] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sid, "s1");
    });

    it("prefers data over properties", () => {
      handleWsEvent(deps, {
        type: "message.created",
        data: {
          sessionID: "from-data",
          message: { id: "m1", role: "assistant" },
        },
        properties: {
          sessionID: "from-properties",
          message: { id: "m2", role: "user" },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [sid, msg] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sid, "from-data");
      assert.equal(msg.id, "m1");
    });

    it("reads message.updated from properties field", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        properties: {
          info: { id: "m1", role: "assistant", sessionID: "s1" },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [sid, msg] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(msg.id, "m1");
    });
  });

  // ===========================================================================
  // Unknown / malformed events
  // ===========================================================================

  describe("unknown events", () => {
    it("ignores unknown event types without error", () => {
      handleWsEvent(deps, { type: "unknown.event", data: {} });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
      assert.equal(deps.addPermission.mock.calls.length, 0);
      assert.equal(deps.updatePermission.mock.calls.length, 0);
    });

    it("ignores session.created events", () => {
      handleWsEvent(deps, {
        type: "session.created",
        data: { info: { id: "ses_123", slug: "happy-wizard" } },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
    });

    it("ignores session.status events", () => {
      handleWsEvent(deps, {
        type: "session.status",
        data: { sessionID: "s1", status: { type: "busy" } },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
    });

    it("handles event with no data or properties", () => {
      handleWsEvent(deps, { type: "message.created" });

      // Should not throw, and should not call any deps
      assert.equal(deps.addMessage.mock.calls.length, 0);
    });
  });

  // ===========================================================================
  // Full OpenCode flow simulation (integration-style)
  // ===========================================================================

  describe("full OpenCode event flow", () => {
    it("processes a complete user prompt → assistant response cycle", () => {
      // 1. User message created (echoed from OpenCode — should be SKIPPED
      //    because user messages are added optimistically by handleSend)
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_user1", role: "user", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 0); // Skipped

      // 2. User text part (still updates text for the server-side message,
      //    but the message doesn't exist locally — this is a no-op in the store)
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            id: "prt_1",
            type: "text",
            text: "say hello",
            messageID: "msg_user1",
            sessionID: "s1",
          },
        },
      });
      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);

      // 3. Assistant message created
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_asst1", role: "assistant", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 1); // Only assistant
      assert.equal(deps.addMessage.mock.calls[0].arguments[1].role, "assistant");
      assert.equal(deps.addMessage.mock.calls[0].arguments[1].streaming, true);

      // 4. Step-start (should be ignored)
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "step-start",
            snapshot: "...",
            messageID: "msg_asst1",
            sessionID: "s1",
          },
        },
      });
      // Still 1 text update (from step 2), step-start is ignored
      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);

      // 5. Text streaming start (empty text)
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "text",
            text: "",
            messageID: "msg_asst1",
            sessionID: "s1",
          },
        },
      });
      // Empty string is still a valid value
      assert.equal(deps.updateLastTextPart.mock.calls.length, 2);

      // 6. Delta (now processed — appends to text part)
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "msg_asst1", sessionID: "s1" },
          field: "text",
          delta: "Hello!",
        },
      });
      assert.equal(deps.appendTextDelta.mock.calls.length, 1);
      assert.equal(deps.appendTextDelta.mock.calls[0].arguments[2], "Hello!");

      // 7. Final text part
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "text",
            text: "Hello! How can I help you?",
            messageID: "msg_asst1",
            sessionID: "s1",
          },
        },
      });
      assert.equal(deps.updateLastTextPart.mock.calls.length, 3);
      assert.equal(
        deps.updateLastTextPart.mock.calls[2].arguments[2],
        "Hello! How can I help you?",
      );

      // 8. Assistant message completed
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: {
            id: "msg_asst1",
            role: "assistant",
            sessionID: "s1",
            finish: "stop",
            time: { created: 1000, completed: 2000 },
          },
        },
      });
      assert.equal(deps.markMessageComplete.mock.calls.length, 1);
      assert.equal(
        deps.markMessageComplete.mock.calls[0].arguments[1],
        "msg_asst1",
      );
    });

    it("processes a tool-using response with OpenCode v1.x part format", () => {
      // 1. Assistant message created (first message — tool call step)
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_asst1", role: "assistant", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 1);

      // 2. Step-start
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "step-start",
            id: "prt_ss1",
            messageID: "msg_asst1",
            sessionID: "s1",
          },
        },
      });

      // 3. Tool part (OpenCode v1.x format — type: "tool", not "tool-invocation")
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "tool",
            id: "prt_tool1",
            tool: "read",
            callID: "toolu_vrtx_abc",
            messageID: "msg_asst1",
            sessionID: "s1",
            state: {
              status: "completed",
              input: { filePath: "/src/app.ts" },
              output: "export default function App() {}",
              time: { start: 1000, end: 1500 },
            },
          },
        },
      });
      assert.equal(deps.upsertToolPart.mock.calls.length, 1);
      assert.equal(deps.addPartToMessage.mock.calls.length, 0);
      const toolPart = deps.upsertToolPart.mock.calls[0].arguments[2];
      assert.equal(toolPart.type, "tool-invocation");
      assert.equal(toolPart.toolName, "read");
      assert.equal(toolPart.content, "export default function App() {}");
      assert.equal(toolPart.callID, "toolu_vrtx_abc");

      // 4. Step-finish for tool call step
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "step-finish",
            id: "prt_sf1",
            messageID: "msg_asst1",
            sessionID: "s1",
          },
        },
      });

      // 5. Second assistant message (final text response)
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_asst2", role: "assistant", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 2);

      // 6. Text response
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          part: {
            type: "text",
            id: "prt_txt1",
            text: "I read the file. It exports App.",
            messageID: "msg_asst2",
            sessionID: "s1",
            time: { start: 2000, end: 2500 },
          },
        },
      });
      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);

      // 7. Final message complete
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: {
            id: "msg_asst2",
            role: "assistant",
            sessionID: "s1",
            finish: "stop",
            time: { created: 2000, completed: 2500 },
          },
        },
      });
      assert.equal(deps.markMessageComplete.mock.calls.length, 1);
    });
  });
});
