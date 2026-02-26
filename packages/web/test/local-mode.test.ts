/**
 * Tests for local-mode detection (auto-connect when served from localhost).
 *
 * Run: node --import tsx --test test/local-mode.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectLocalMode } from "../src/lib/local-mode.js";

describe("local mode detection", () => {
  it("detects local mode when served from localhost", () => {
    const result = detectLocalMode("http://localhost:3000");
    assert.equal(result.isLocal, true);
    if (!result.isLocal) return;
    assert.equal(result.serverUrl, "http://localhost:3000");
    assert.equal(result.wsUrl, "ws://localhost:3000");
    assert.equal(result.apiToken, "mast-api-token-phase1");
  });

  it("detects local mode on any localhost port", () => {
    const result = detectLocalMode("http://localhost:8080");
    assert.equal(result.isLocal, true);
    if (!result.isLocal) return;
    assert.equal(result.serverUrl, "http://localhost:8080");
    assert.equal(result.wsUrl, "ws://localhost:8080");
  });

  it("detects local mode on 127.0.0.1", () => {
    const result = detectLocalMode("http://127.0.0.1:3000");
    assert.equal(result.isLocal, true);
    if (!result.isLocal) return;
    assert.equal(result.serverUrl, "http://127.0.0.1:3000");
    assert.equal(result.wsUrl, "ws://127.0.0.1:3000");
  });

  it("does not detect local mode for remote URLs", () => {
    const result = detectLocalMode("https://mast.example.com");
    assert.equal(result.isLocal, false);
  });

  it("detects local mode for https://localhost (derives wss:)", () => {
    const result = detectLocalMode("https://localhost:3000");
    assert.equal(result.isLocal, true);
    if (!result.isLocal) return;
    assert.equal(result.wsUrl, "wss://localhost:3000");
  });

  it("returns isLocal false for garbage input", () => {
    const result = detectLocalMode("not-a-url");
    assert.equal(result.isLocal, false);
  });
});
