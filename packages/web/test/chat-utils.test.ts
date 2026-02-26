/**
 * Tests for chat utility functions.
 * Covers: formatArgs, formatTimestamp
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatArgs, formatTimestamp } from "../src/lib/chat-utils.js";

// ---------------------------------------------------------------------------
// formatArgs
// ---------------------------------------------------------------------------

describe("formatArgs", () => {
  it("pretty-prints valid JSON", () => {
    const input = '{"path":"/foo","content":"bar"}';
    const result = formatArgs(input);
    assert.equal(result, '{\n  "path": "/foo",\n  "content": "bar"\n}');
  });

  it("returns raw string for invalid JSON", () => {
    const input = "not json";
    assert.equal(formatArgs(input), "not json");
  });

  it("returns empty string for empty input", () => {
    assert.equal(formatArgs(""), "");
  });

  it("handles arrays", () => {
    const input = '["a","b"]';
    const result = formatArgs(input);
    assert.equal(result, '[\n  "a",\n  "b"\n]');
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats ISO date to HH:MM", () => {
    // Use a fixed date and check it produces a time string
    const result = formatTimestamp("2026-02-25T14:30:00Z");
    assert.ok(result !== null);
    // Should be in HH:MM format (locale-dependent, just check it's a string with : )
    assert.ok(typeof result === "string");
    assert.ok(result.includes(":"));
  });

  it("returns null for empty string", () => {
    assert.equal(formatTimestamp(""), null);
  });

  it("returns null for undefined", () => {
    assert.equal(formatTimestamp(undefined), null);
  });
});
