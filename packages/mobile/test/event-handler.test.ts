/**
 * Tests for the WebSocket event handler.
 *
 * This is a pure function with no React/React Native dependencies,
 * so it can be tested with node:test directly.
 *
 * Run: npx tsx --test packages/mobile/test/event-handler.test.ts
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  handleWsEvent,
  type EventHandlerDeps,
} from "../src/lib/event-handler";

function createMockDeps() {
  return {
    addMessage: mock.fn<EventHandlerDeps["addMessage"]>(),
    updateLastTextPart: mock.fn<EventHandlerDeps["updateLastTextPart"]>(),
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

    it("adds a new user message with streaming=false", () => {
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "m2", role: "user", sessionID: "s1" },
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 1);
      const [, message] = deps.addMessage.mock.calls[0].arguments;
      assert.equal(message.streaming, false);
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

    it("ignores non-text parts (tool-invocation)", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          sessionID: "s1",
          messageID: "m1",
          part: { type: "tool-invocation", toolName: "bash" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
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
  // message.part.delta — currently skipped (full text via part.updated)
  // ===========================================================================

  describe("message.part.delta", () => {
    it("does not call any deps (intentionally skipped)", () => {
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "m1", sessionID: "s1" },
          field: "text",
          delta: "OK",
        },
      });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
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
      // 1. User message created
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_user1", role: "user", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 1);
      assert.equal(deps.addMessage.mock.calls[0].arguments[1].role, "user");

      // 2. User text part
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
      assert.equal(
        deps.updateLastTextPart.mock.calls[0].arguments[2],
        "say hello",
      );

      // 3. Assistant message created
      handleWsEvent(deps, {
        type: "message.updated",
        data: {
          info: { id: "msg_asst1", role: "assistant", sessionID: "s1" },
        },
      });
      assert.equal(deps.addMessage.mock.calls.length, 2);
      assert.equal(deps.addMessage.mock.calls[1].arguments[1].role, "assistant");
      assert.equal(deps.addMessage.mock.calls[1].arguments[1].streaming, true);

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

      // 6. Delta (skipped)
      handleWsEvent(deps, {
        type: "message.part.delta",
        data: {
          part: { messageID: "msg_asst1", sessionID: "s1" },
          field: "text",
          delta: "Hello!",
        },
      });
      // No new call — deltas are skipped
      assert.equal(deps.updateLastTextPart.mock.calls.length, 2);

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
  });
});
