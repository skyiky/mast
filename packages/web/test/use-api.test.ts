/**
 * Tests for useApi hook logic.
 *
 * We test the extracted `createApiBinding` function rather than the
 * React hook directly, since we run under node:test with no jsdom.
 *
 * Strategy: We mock `fetch` globally and verify each bound method
 * calls fetch with the correct URL, method, and body.
 *
 * Run: node --import tsx --test --test-force-exit test/use-api.test.ts
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mock fetch globally before importing
// ---------------------------------------------------------------------------

let fetchCalls: Array<{ url: string; opts: RequestInit }> = [];

globalThis.fetch = (async (url: string, opts?: RequestInit) => {
  fetchCalls.push({ url, opts: opts ?? {} });
  return {
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
  };
}) as any;

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { createApiBinding, type BoundApi } from "../src/hooks/useApi.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createApiBinding", () => {
  let api: BoundApi;

  beforeEach(() => {
    fetchCalls = [];
    api = createApiBinding("https://test.example.com", "tok-123");
  });

  it("returns an object with all expected API methods", () => {
    const expectedMethods = [
      "health",
      "sessions",
      "newSession",
      "messages",
      "prompt",
      "approve",
      "deny",
      "pair",
      "abort",
      "diff",
      "providers",
      "projectCurrent",
      "revert",
      "projects",
      "addProject",
      "removeProject",
      "mcpServers",
    ];

    for (const method of expectedMethods) {
      assert.equal(typeof (api as any)[method], "function", `expected api.${method} to be a function`);
    }
  });

  it("does NOT include pushToken (not applicable for web)", () => {
    assert.equal((api as any).pushToken, undefined);
  });

  it("health() calls fetch with correct URL and auth header", async () => {
    await api.health();

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://test.example.com/health");
    const headers = fetchCalls[0].opts.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer tok-123");
  });

  it("sessions() calls GET /sessions", async () => {
    await api.sessions();
    assert.ok(fetchCalls[0].url.endsWith("/sessions"));
    assert.equal(fetchCalls[0].opts.method, "GET");
  });

  it("newSession() calls POST /sessions", async () => {
    await api.newSession();
    assert.ok(fetchCalls[0].url.endsWith("/sessions"));
    assert.equal(fetchCalls[0].opts.method, "POST");
  });

  it("newSession(project) includes project in body", async () => {
    await api.newSession("my-project");
    const body = JSON.parse(fetchCalls[0].opts.body as string);
    assert.equal(body.project, "my-project");
  });

  it("messages(sessionId) calls GET /sessions/:id/messages", async () => {
    await api.messages("sess-42");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-42/messages"));
  });

  it("prompt() calls POST /sessions/:id/prompt", async () => {
    await api.prompt("sess-1", "hello world");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/prompt"));
    assert.equal(fetchCalls[0].opts.method, "POST");
    const body = JSON.parse(fetchCalls[0].opts.body as string);
    // api.ts wraps text in parts array
    assert.deepEqual(body.parts, [{ type: "text", text: "hello world" }]);
  });

  it("approve() calls POST with /approve path", async () => {
    await api.approve("sess-1", "perm-1");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/approve/perm-1"));
    assert.equal(fetchCalls[0].opts.method, "POST");
  });

  it("deny() calls POST with /deny path", async () => {
    await api.deny("sess-1", "perm-1");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/deny/perm-1"));
  });

  it("pair() calls POST /pair/verify with code", async () => {
    await api.pair("ABC123");
    assert.ok(fetchCalls[0].url.includes("/pair/verify"));
    const body = JSON.parse(fetchCalls[0].opts.body as string);
    assert.equal(body.code, "ABC123");
  });

  it("abort() calls POST /sessions/:id/abort", async () => {
    await api.abort("sess-1");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/abort"));
  });

  it("diff() calls GET /sessions/:id/diff", async () => {
    await api.diff("sess-1");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/diff"));
  });

  it("providers() calls GET /providers", async () => {
    await api.providers();
    assert.ok(fetchCalls[0].url.endsWith("/providers"));
  });

  it("projectCurrent() calls GET /project/current", async () => {
    await api.projectCurrent();
    assert.ok(fetchCalls[0].url.includes("/project/current"));
  });

  it("revert() calls POST /sessions/:id/revert", async () => {
    await api.revert("sess-1", "msg-5");
    assert.ok(fetchCalls[0].url.includes("/sessions/sess-1/revert"));
    const body = JSON.parse(fetchCalls[0].opts.body as string);
    assert.equal(body.messageID, "msg-5");
  });

  it("projects() calls GET /projects", async () => {
    await api.projects();
    assert.ok(fetchCalls[0].url.endsWith("/projects"));
  });

  it("addProject() calls POST /projects with name and directory", async () => {
    await api.addProject("proj1", "/home/user/proj1");
    assert.ok(fetchCalls[0].url.endsWith("/projects"));
    assert.equal(fetchCalls[0].opts.method, "POST");
    const body = JSON.parse(fetchCalls[0].opts.body as string);
    assert.equal(body.name, "proj1");
    assert.equal(body.directory, "/home/user/proj1");
  });

  it("removeProject() calls DELETE /projects/:name", async () => {
    await api.removeProject("proj1");
    assert.ok(fetchCalls[0].url.includes("/projects/proj1"));
    assert.equal(fetchCalls[0].opts.method, "DELETE");
  });

  it("mcpServers() calls GET /mcp-servers", async () => {
    await api.mcpServers();
    assert.ok(fetchCalls[0].url.endsWith("/mcp-servers"));
  });

  it("uses updated config when re-created with new values", async () => {
    const api2 = createApiBinding("https://other.example.com", "new-token");
    await api2.health();

    assert.ok(fetchCalls[0].url.startsWith("https://other.example.com"));
    const headers = fetchCalls[0].opts.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer new-token");
  });
});
