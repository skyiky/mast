import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapApiMessages } from "../src/lib/types.js";

describe("mapApiMessages", () => {
  // -----------------------------------------------------------------------
  // OpenCode REST API format: { info: { id, role, ... }, parts: [...] }
  // -----------------------------------------------------------------------

  describe("OpenCode REST format ({ info, parts })", () => {
    it("maps user message with text part", () => {
      const result = mapApiMessages([
        {
          info: { id: "msg_1", role: "user", time: { created: 1772082860123 } },
          parts: [{ type: "text", text: "What is 2+2?" }],
        },
      ]);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, "msg_1");
      assert.equal(result[0].role, "user");
      assert.equal(result[0].parts.length, 1);
      assert.equal(result[0].parts[0].type, "text");
      assert.equal(result[0].parts[0].content, "What is 2+2?");
    });

    it("maps assistant message with text part", () => {
      const result = mapApiMessages([
        {
          info: { id: "msg_2", role: "assistant", time: { created: 1772082860200, completed: 1772082861000 } },
          parts: [{ type: "text", text: "The answer is 4." }],
        },
      ]);
      assert.equal(result[0].id, "msg_2");
      assert.equal(result[0].role, "assistant");
      assert.equal(result[0].parts[0].content, "The answer is 4.");
    });

    it("derives createdAt from info.time.created", () => {
      const result = mapApiMessages([
        {
          info: { id: "msg_3", role: "user", time: { created: 1772082860123 } },
          parts: [{ type: "text", text: "hi" }],
        },
      ]);
      assert.equal(result[0].createdAt, new Date(1772082860123).toISOString());
    });

    it("maps tool parts from OpenCode format", () => {
      const result = mapApiMessages([
        {
          info: { id: "msg_4", role: "assistant" },
          parts: [{
            type: "tool", tool: "read", callID: "c1",
            state: { input: { path: "/foo" }, output: "file contents" },
          }],
        },
      ]);
      const part = result[0].parts[0];
      assert.equal(part.type, "tool-invocation");
      assert.equal(part.toolName, "read");
      assert.equal(part.toolArgs, JSON.stringify({ path: "/foo" }));
      assert.equal(part.content, "file contents");
    });

    it("handles assistant message with no parts (empty streaming)", () => {
      const result = mapApiMessages([
        {
          info: { id: "msg_5", role: "assistant" },
          parts: [],
        },
      ]);
      assert.equal(result[0].id, "msg_5");
      assert.deepStrictEqual(result[0].parts, []);
    });
  });

  // -----------------------------------------------------------------------
  // Flat / orchestrator cache format: { id, role, parts, streaming, ... }
  // -----------------------------------------------------------------------

  describe("flat / cache format", () => {
    it("maps text part using 'text' field", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "text", text: "Hello world" }] },
      ]);
      assert.equal(result.length, 1);
      assert.equal(result[0].parts[0].content, "Hello world");
      assert.equal(result[0].parts[0].type, "text");
    });

    it("maps text part using 'content' field (legacy)", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "text", content: "Hello legacy" }] },
      ]);
      assert.equal(result[0].parts[0].content, "Hello legacy");
    });

    it("prefers 'text' over 'content' when both present", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "text", text: "from text", content: "from content" }] },
      ]);
      assert.equal(result[0].parts[0].content, "from text");
    });

    it("normalizes type 'tool' to 'tool-invocation'", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "tool", toolName: "read", callID: "c1" }] },
      ]);
      assert.equal(result[0].parts[0].type, "tool-invocation");
      assert.equal(result[0].parts[0].toolName, "read");
      assert.equal(result[0].parts[0].callID, "c1");
    });

    it("copies toolName, toolArgs, callID from tool-invocation parts", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "tool-invocation", toolName: "write", toolArgs: '{"path":"f"}', callID: "c2", content: "done" }] },
      ]);
      const part = result[0].parts[0];
      assert.equal(part.toolName, "write");
      assert.equal(part.toolArgs, '{"path":"f"}');
      assert.equal(part.callID, "c2");
      assert.equal(part.content, "done");
    });

    it("reads toolName from 'tool' field when toolName is absent", () => {
      const result = mapApiMessages([
        { id: "m1", role: "assistant", parts: [{ type: "tool", tool: "bash" }] },
      ]);
      assert.equal(result[0].parts[0].toolName, "bash");
    });

    it("extracts input/output from state (OpenCode v1 tool format)", () => {
      const result = mapApiMessages([
        {
          id: "m1", role: "assistant", parts: [{
            type: "tool", tool: "read", callID: "c3",
            state: { input: { path: "/foo" }, output: "file contents here" },
          }],
        },
      ]);
      const part = result[0].parts[0];
      assert.equal(part.toolArgs, JSON.stringify({ path: "/foo" }));
      assert.equal(part.content, "file contents here");
    });

    it("state.error overrides content", () => {
      const result = mapApiMessages([
        {
          id: "m1", role: "assistant", parts: [{
            type: "tool", tool: "bash", callID: "c4",
            state: { output: "ok", error: "permission denied" },
          }],
        },
      ]);
      assert.equal(result[0].parts[0].content, "permission denied");
    });

    it("defaults role to assistant, streaming to false", () => {
      const result = mapApiMessages([{ id: "m1", role: "" }]);
      assert.equal(result[0].role, "assistant");
      assert.equal(result[0].streaming, false);
    });

    it("synthesizes text part from top-level content when parts missing", () => {
      const result = mapApiMessages([
        { id: "m1", role: "user", content: "What is 2+2?" },
      ]);
      assert.equal(result[0].role, "user");
      assert.equal(result[0].parts.length, 1);
      assert.equal(result[0].parts[0].content, "What is 2+2?");
    });

    it("synthesizes text part from top-level content when parts is empty", () => {
      const result = mapApiMessages([
        { id: "m1", role: "user", content: "Hello", parts: [] },
      ]);
      assert.equal(result[0].parts.length, 1);
      assert.equal(result[0].parts[0].content, "Hello");
    });

    it("prefers parts over top-level content when both present", () => {
      const result = mapApiMessages([
        { id: "m1", role: "user", content: "top-level", parts: [{ type: "text", text: "from parts" }] },
      ]);
      assert.equal(result[0].parts.length, 1);
      assert.equal(result[0].parts[0].content, "from parts");
    });

    it("handles messages with no parts and no content", () => {
      const result = mapApiMessages([{ id: "m1", role: "user" }]);
      assert.deepStrictEqual(result[0].parts, []);
    });

    it("maps user message with text part and metadata", () => {
      const result = mapApiMessages([
        { id: "m1", role: "user", parts: [{ type: "text", text: "What is 2+2?" }], streaming: false, createdAt: "2026-01-01T00:00:00Z" },
      ]);
      assert.equal(result[0].role, "user");
      assert.equal(result[0].parts[0].content, "What is 2+2?");
      assert.equal(result[0].streaming, false);
      assert.equal(result[0].createdAt, "2026-01-01T00:00:00Z");
    });
  });

  it("handles empty array", () => {
    assert.deepStrictEqual(mapApiMessages([]), []);
  });
});
