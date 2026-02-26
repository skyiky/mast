/**
 * Tests for the Zustand sessions store.
 *
 * Run: node --import tsx --test --test-force-exit test/sessions-store.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useSessionStore } from "../src/stores/sessions.js";
import type { ChatMessage, MessagePart } from "../src/lib/types.js";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    parts: [],
    streaming: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("sessions store", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      messagesBySession: {},
      permissions: [],
      loadingSessions: false,
      activeSessionId: null,
      deletedSessionIds: [],
    });
  });

  // ===========================================================================
  // Sessions CRUD
  // ===========================================================================

  describe("sessions CRUD", () => {
    it("setSessions replaces the session list", () => {
      const sessions = [
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
        { id: "s2", title: "B", createdAt: "", updatedAt: "" },
      ];
      useSessionStore.getState().setSessions(sessions);
      assert.equal(useSessionStore.getState().sessions.length, 2);
      assert.equal(useSessionStore.getState().sessions[0].id, "s1");
    });

    it("addSession prepends and deduplicates", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().addSession({
        id: "s2", title: "B", createdAt: "", updatedAt: "",
      });
      assert.equal(useSessionStore.getState().sessions.length, 2);
      assert.equal(useSessionStore.getState().sessions[0].id, "s2");

      // Duplicate — should not add
      useSessionStore.getState().addSession({
        id: "s2", title: "B", createdAt: "", updatedAt: "",
      });
      assert.equal(useSessionStore.getState().sessions.length, 2);
    });

    it("removeSession removes from list and tracks deletion", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
        { id: "s2", title: "B", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().setMessages("s1", [makeMessage()]);

      useSessionStore.getState().removeSession("s1");

      assert.equal(useSessionStore.getState().sessions.length, 1);
      assert.equal(useSessionStore.getState().sessions[0].id, "s2");
      assert.deepEqual(useSessionStore.getState().deletedSessionIds, ["s1"]);
      // Messages for deleted session should be cleaned up
      assert.equal(useSessionStore.getState().messagesBySession["s1"], undefined);
    });

    it("removeSession does not duplicate deletedSessionIds", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().removeSession("s1");
      useSessionStore.getState().removeSession("s1"); // again
      assert.equal(useSessionStore.getState().deletedSessionIds.length, 1);
    });
  });

  // ===========================================================================
  // Messages
  // ===========================================================================

  describe("messages", () => {
    it("setMessages stores messages for a session", () => {
      const msgs = [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })];
      useSessionStore.getState().setMessages("s1", msgs);
      assert.equal(useSessionStore.getState().messagesBySession["s1"].length, 2);
    });

    it("addMessage appends without duplicates", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().addMessage("s1", makeMessage({ id: "m1" }));
      useSessionStore.getState().addMessage("s1", makeMessage({ id: "m2" }));
      assert.equal(useSessionStore.getState().messagesBySession["s1"].length, 2);

      // Duplicate
      useSessionStore.getState().addMessage("s1", makeMessage({ id: "m1" }));
      assert.equal(useSessionStore.getState().messagesBySession["s1"].length, 2);
    });

    it("removeMessage removes by ID", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1" }),
        makeMessage({ id: "m2" }),
      ]);
      useSessionStore.getState().removeMessage("s1", "m1");
      assert.equal(useSessionStore.getState().messagesBySession["s1"].length, 1);
      assert.equal(useSessionStore.getState().messagesBySession["s1"][0].id, "m2");
    });

    it("updateLastTextPart creates text part if none exists", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [] }),
      ]);
      useSessionStore.getState().updateLastTextPart("s1", "m1", "Hello");
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts.length, 1);
      assert.equal(parts[0].type, "text");
      assert.equal(parts[0].content, "Hello");
    });

    it("updateLastTextPart updates existing text part", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [{ type: "text", content: "Old" }] }),
      ]);
      useSessionStore.getState().updateLastTextPart("s1", "m1", "New");
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts[0].content, "New");
    });

    it("updateLastTextPart does not overwrite content with empty string", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [{ type: "text", content: "Existing" }] }),
      ]);
      useSessionStore.getState().updateLastTextPart("s1", "m1", "");
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts[0].content, "Existing");
    });

    it("appendTextDelta appends to existing text part", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [{ type: "text", content: "Hel" }] }),
      ]);
      useSessionStore.getState().appendTextDelta("s1", "m1", "lo!");
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts[0].content, "Hello!");
    });

    it("appendTextDelta creates text part if none exists", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [] }),
      ]);
      useSessionStore.getState().appendTextDelta("s1", "m1", "First");
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts.length, 1);
      assert.equal(parts[0].content, "First");
    });

    it("addPartToMessage appends a part", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [{ type: "text", content: "hi" }] }),
      ]);
      useSessionStore.getState().addPartToMessage("s1", "m1", {
        type: "tool-invocation",
        content: "ls -la",
        toolName: "bash",
      });
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts.length, 2);
      assert.equal(parts[1].type, "tool-invocation");
    });

    it("upsertToolPart appends when no matching callID", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", parts: [] }),
      ]);
      useSessionStore.getState().upsertToolPart("s1", "m1", {
        type: "tool-invocation",
        content: "",
        toolName: "read",
        callID: "call-1",
      });
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts.length, 1);
      assert.equal(parts[0].callID, "call-1");
    });

    it("upsertToolPart updates existing part with same callID", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({
          id: "m1",
          parts: [
            { type: "tool-invocation", content: "", toolName: "read", callID: "call-1" },
          ],
        }),
      ]);
      useSessionStore.getState().upsertToolPart("s1", "m1", {
        type: "tool-invocation",
        content: "file contents here",
        toolName: "read",
        callID: "call-1",
      });
      const parts = useSessionStore.getState().messagesBySession["s1"][0].parts;
      assert.equal(parts.length, 1); // Still 1 part, not 2
      assert.equal(parts[0].content, "file contents here");
    });

    it("markMessageComplete sets streaming to false", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", streaming: true }),
      ]);
      useSessionStore.getState().markMessageComplete("s1", "m1");
      assert.equal(
        useSessionStore.getState().messagesBySession["s1"][0].streaming,
        false,
      );
    });

    it("markAllStreamsComplete marks all streaming messages as complete", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", streaming: true }),
        makeMessage({ id: "m2", streaming: false }),
      ]);
      useSessionStore.getState().setMessages("s2", [
        makeMessage({ id: "m3", streaming: true }),
      ]);
      useSessionStore.getState().markAllStreamsComplete();

      const s1 = useSessionStore.getState().messagesBySession["s1"];
      const s2 = useSessionStore.getState().messagesBySession["s2"];
      assert.equal(s1[0].streaming, false);
      assert.equal(s1[1].streaming, false);
      assert.equal(s2[0].streaming, false);
    });

    it("markAllStreamsComplete is a no-op when no streaming messages", () => {
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", streaming: false }),
      ]);
      const before = useSessionStore.getState().messagesBySession;
      useSessionStore.getState().markAllStreamsComplete();
      const after = useSessionStore.getState().messagesBySession;
      // Should be the exact same reference (no unnecessary re-render)
      assert.equal(before, after);
    });
  });

  // ===========================================================================
  // Permissions
  // ===========================================================================

  describe("permissions", () => {
    it("addPermission appends to the list", () => {
      useSessionStore.getState().addPermission({
        id: "p1",
        sessionId: "s1",
        description: "Allow write",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      assert.equal(useSessionStore.getState().permissions.length, 1);
      assert.equal(useSessionStore.getState().permissions[0].id, "p1");
    });

    it("updatePermission changes status", () => {
      useSessionStore.getState().addPermission({
        id: "p1",
        sessionId: "s1",
        description: "Allow write",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      useSessionStore.getState().updatePermission("p1", "approved");
      assert.equal(useSessionStore.getState().permissions[0].status, "approved");
    });

    it("clearPermissions removes permissions for a session", () => {
      useSessionStore.getState().addPermission({
        id: "p1", sessionId: "s1", description: "A", status: "pending", createdAt: "",
      });
      useSessionStore.getState().addPermission({
        id: "p2", sessionId: "s2", description: "B", status: "pending", createdAt: "",
      });
      useSessionStore.getState().clearPermissions("s1");
      assert.equal(useSessionStore.getState().permissions.length, 1);
      assert.equal(useSessionStore.getState().permissions[0].id, "p2");
    });
  });

  // ===========================================================================
  // Active session & activity tracking
  // ===========================================================================

  describe("active session", () => {
    it("setActiveSessionId sets the active session", () => {
      useSessionStore.getState().setActiveSessionId("s1");
      assert.equal(useSessionStore.getState().activeSessionId, "s1");
    });

    it("setActiveSessionId clears hasActivity on the opened session", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "", hasActivity: true },
      ]);
      useSessionStore.getState().setActiveSessionId("s1");
      assert.equal(useSessionStore.getState().sessions[0].hasActivity, false);
    });

    it("addMessage marks non-active session as having activity", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().setActiveSessionId("s2"); // Different session is active
      useSessionStore.getState().addMessage("s1", makeMessage({ id: "m1" }));
      assert.equal(useSessionStore.getState().sessions[0].hasActivity, true);
    });
  });

  // ===========================================================================
  // Session preview
  // ===========================================================================

  describe("session preview", () => {
    it("setSessionPreview updates the preview", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().setSessionPreview("s1", "Hello world");
      assert.equal(useSessionStore.getState().sessions[0].lastMessagePreview, "Hello world");
    });

    it("setMessages derives preview from last user message", () => {
      useSessionStore.getState().setSessions([
        { id: "s1", title: "A", createdAt: "", updatedAt: "" },
      ]);
      useSessionStore.getState().setMessages("s1", [
        makeMessage({ id: "m1", role: "user", parts: [{ type: "text", content: "First" }] }),
        makeMessage({ id: "m2", role: "assistant", parts: [{ type: "text", content: "Reply" }] }),
        makeMessage({ id: "m3", role: "user", parts: [{ type: "text", content: "Last user msg" }] }),
      ]);
      assert.equal(useSessionStore.getState().sessions[0].lastMessagePreview, "Last user msg");
    });
  });
});
