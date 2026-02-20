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

  // ---------------------------------------------------------------------------
  // message.created
  // ---------------------------------------------------------------------------

  describe("message.created", () => {
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

  // ---------------------------------------------------------------------------
  // message.part.created / message.part.updated
  // ---------------------------------------------------------------------------

  describe("message.part.updated", () => {
    it("updates text part content", () => {
      handleWsEvent(deps, {
        type: "message.part.updated",
        data: {
          sessionID: "s1",
          messageID: "m1",
          part: { type: "text", content: "Hello world" },
        },
      });

      assert.equal(deps.updateLastTextPart.mock.calls.length, 1);
      const [sid, mid, text] =
        deps.updateLastTextPart.mock.calls[0].arguments;
      assert.equal(sid, "s1");
      assert.equal(mid, "m1");
      assert.equal(text, "Hello world");
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

    it("ignores non-text parts", () => {
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
  });

  // ---------------------------------------------------------------------------
  // message.completed
  // ---------------------------------------------------------------------------

  describe("message.completed", () => {
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

  // ---------------------------------------------------------------------------
  // permission.created
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // permission.updated
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Properties normalization (OpenCode SSE compat)
  // ---------------------------------------------------------------------------

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
  });

  // ---------------------------------------------------------------------------
  // Unknown / malformed events
  // ---------------------------------------------------------------------------

  describe("unknown events", () => {
    it("ignores unknown event types without error", () => {
      handleWsEvent(deps, { type: "unknown.event", data: {} });

      assert.equal(deps.addMessage.mock.calls.length, 0);
      assert.equal(deps.updateLastTextPart.mock.calls.length, 0);
      assert.equal(deps.markMessageComplete.mock.calls.length, 0);
      assert.equal(deps.addPermission.mock.calls.length, 0);
      assert.equal(deps.updatePermission.mock.calls.length, 0);
    });

    it("handles event with no data or properties", () => {
      handleWsEvent(deps, { type: "message.created" });

      // Should not throw, and should not call any deps
      assert.equal(deps.addMessage.mock.calls.length, 0);
    });
  });
});
