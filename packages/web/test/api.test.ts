/**
 * Tests for the API client — project management functions and
 * createSession with optional project param.
 *
 * Pure fetch-based code with no React dependencies,
 * so it can be tested with node:test directly.
 *
 * Run: node --import tsx --test --test-force-exit test/api.test.ts
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  fetchProjects,
  addProject,
  removeProject,
  createSession,
  fetchSessions,
  type ApiConfig,
  type Project,
} from "../src/lib/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: ApiConfig = {
  serverUrl: "https://test.example.com",
  apiToken: "test-token-abc",
};

/** Build a minimal Response-like object that fetch() would return. */
function fakeResponse(status: number, body?: unknown): Response {
  const text = body !== undefined ? JSON.stringify(body) : "";
  return {
    status,
    text: async () => text,
    // Minimal stubs so TS is happy — the code only calls .status and .text()
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic",
    url: "",
    clone: () => fakeResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => body,
    bytes: async () => new Uint8Array(),
  } as Response;
}

/** Capture the most recent fetch call's URL, method, headers, and body. */
function lastFetchCall(fetchMock: ReturnType<typeof mock.fn>) {
  const calls = fetchMock.mock.calls;
  assert.ok(calls.length > 0, "expected at least one fetch call");
  const [url, opts] = calls[calls.length - 1].arguments as [
    string,
    RequestInit,
  ];
  return { url, method: opts.method, headers: opts.headers, body: opts.body };
}

// ---------------------------------------------------------------------------
// Setup / teardown — mock globalThis.fetch
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;
let fetchMock: ReturnType<typeof mock.fn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock.fn<typeof globalThis.fetch>();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// fetchProjects
// ===========================================================================

describe("fetchProjects", () => {
  it("sends GET /projects with auth header", async () => {
    const projects: Project[] = [
      { name: "mast", directory: "/home/dev/mast", port: 4096, ready: true },
    ];
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, projects));

    const res = await fetchProjects(TEST_CONFIG);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, projects);

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/projects");
    assert.equal(call.method, "GET");
    assert.equal(
      (call.headers as Record<string, string>).Authorization,
      "Bearer test-token-abc",
    );
    assert.equal(call.body, undefined);
  });

  it("returns multiple projects", async () => {
    const projects: Project[] = [
      { name: "mast", directory: "/home/dev/mast", port: 4096, ready: true },
      { name: "other", directory: "/home/dev/other", port: 4097, ready: false },
    ];
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, projects));

    const res = await fetchProjects(TEST_CONFIG);

    assert.equal(res.status, 200);
    assert.equal((res.body as Project[]).length, 2);
    assert.equal((res.body as Project[])[1].name, "other");
    assert.equal((res.body as Project[])[1].ready, false);
  });

  it("returns empty array when no projects", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, []));

    const res = await fetchProjects(TEST_CONFIG);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("handles server error", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(500, { error: "internal error" }),
    );

    const res = await fetchProjects(TEST_CONFIG);

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "internal error" });
  });
});

// ===========================================================================
// addProject
// ===========================================================================

describe("addProject", () => {
  it("sends POST /projects with name and directory in body", async () => {
    const created: Project = {
      name: "my-app",
      directory: "/home/dev/my-app",
      port: 4097,
      ready: false,
    };
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, created));

    const res = await addProject(TEST_CONFIG, "my-app", "/home/dev/my-app");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, created);

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/projects");
    assert.equal(call.method, "POST");
    assert.deepEqual(JSON.parse(call.body as string), {
      name: "my-app",
      directory: "/home/dev/my-app",
    });
  });

  it("sends auth header", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, { name: "x", directory: "/x", port: 0, ready: false }),
    );

    await addProject(TEST_CONFIG, "x", "/x");

    const call = lastFetchCall(fetchMock);
    assert.equal(
      (call.headers as Record<string, string>).Authorization,
      "Bearer test-token-abc",
    );
  });

  it("handles 409 conflict (duplicate project)", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(409, { error: "project already exists" }),
    );

    const res = await addProject(TEST_CONFIG, "dup", "/dup");

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "project already exists" });
  });

  it("handles Windows paths with backslashes", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, {
        name: "win-proj",
        directory: "C:\\Users\\dev\\project",
        port: 4098,
        ready: false,
      }),
    );

    const res = await addProject(
      TEST_CONFIG,
      "win-proj",
      "C:\\Users\\dev\\project",
    );

    const call = lastFetchCall(fetchMock);
    const body = JSON.parse(call.body as string);
    assert.equal(body.directory, "C:\\Users\\dev\\project");
    assert.equal(res.status, 200);
  });
});

// ===========================================================================
// removeProject
// ===========================================================================

describe("removeProject", () => {
  it("sends DELETE /projects/:name", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    const res = await removeProject(TEST_CONFIG, "my-app");

    assert.equal(res.status, 204);
    assert.equal(res.body, null); // 204 = empty body

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/projects/my-app");
    assert.equal(call.method, "DELETE");
  });

  it("encodes project names with spaces", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    await removeProject(TEST_CONFIG, "my app");

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/projects/my%20app");
  });

  it("encodes project names with slashes", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    await removeProject(TEST_CONFIG, "org/repo");

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/projects/org%2Frepo");
  });

  it("encodes project names with special characters", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    await removeProject(TEST_CONFIG, "proj#1&v=2");

    const call = lastFetchCall(fetchMock);
    assert.equal(
      call.url,
      "https://test.example.com/projects/proj%231%26v%3D2",
    );
  });

  it("encodes unicode project names", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    await removeProject(TEST_CONFIG, "日本語プロジェクト");

    const call = lastFetchCall(fetchMock);
    // Just verify it was encoded (not raw unicode in URL)
    assert.ok(!call.url.includes("日本語"), "URL should encode unicode chars");
    assert.ok(call.url.startsWith("https://test.example.com/projects/"));
  });

  it("handles 404 (project not found)", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(404, { error: "project not found" }),
    );

    const res = await removeProject(TEST_CONFIG, "ghost");

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "project not found" });
  });

  it("does not send a request body", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    await removeProject(TEST_CONFIG, "x");

    const call = lastFetchCall(fetchMock);
    assert.equal(call.body, undefined);
  });
});

// ===========================================================================
// createSession — optional project param
// ===========================================================================

describe("createSession", () => {
  it("sends POST /sessions without body when no project specified", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, { id: "sess-1" }),
    );

    const res = await createSession(TEST_CONFIG);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: "sess-1" });

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/sessions");
    assert.equal(call.method, "POST");
    assert.equal(call.body, undefined);
  });

  it("sends POST /sessions with project in body when specified", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, { id: "sess-2" }),
    );

    const res = await createSession(TEST_CONFIG, "my-app");

    assert.equal(res.status, 200);

    const call = lastFetchCall(fetchMock);
    assert.equal(call.url, "https://test.example.com/sessions");
    assert.equal(call.method, "POST");
    assert.deepEqual(JSON.parse(call.body as string), { project: "my-app" });
  });

  it("does not include project key when project is undefined", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, { id: "sess-3" }),
    );

    await createSession(TEST_CONFIG, undefined);

    const call = lastFetchCall(fetchMock);
    assert.equal(call.body, undefined);
  });

  it("does not include project key when project is empty string", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fakeResponse(200, { id: "sess-4" }),
    );

    // Empty string is falsy, so createSession should treat it like no project
    await createSession(TEST_CONFIG, "");

    const call = lastFetchCall(fetchMock);
    assert.equal(call.body, undefined);
  });
});

// ===========================================================================
// fetchSessions — project field in response
// ===========================================================================

describe("fetchSessions", () => {
  it("returns sessions with project field", async () => {
    const sessions = [
      { id: "s1", title: "test", project: "mast" },
      { id: "s2", title: "other", project: "my-app" },
      { id: "s3", title: "old" }, // no project field
    ];
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, sessions));

    const res = await fetchSessions(TEST_CONFIG);

    assert.equal(res.status, 200);
    const body = res.body as Array<{ id: string; project?: string }>;
    assert.equal(body[0].project, "mast");
    assert.equal(body[1].project, "my-app");
    assert.equal(body[2].project, undefined);
  });
});

// ===========================================================================
// request() internals — shared behavior tested via the project functions
// ===========================================================================

describe("request() shared behavior", () => {
  it("sets Content-Type to application/json", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(200, []));

    await fetchProjects(TEST_CONFIG);

    const call = lastFetchCall(fetchMock);
    assert.equal(
      (call.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );
  });

  it("returns body as raw text when JSON parsing fails", async () => {
    // Simulate a response that isn't valid JSON
    const rawResponse = {
      status: 200,
      text: async () => "not-json-at-all",
      ok: true,
      headers: new Headers(),
      redirected: false,
      statusText: "OK",
      type: "basic",
      url: "",
      clone: () => rawResponse,
      body: null,
      bodyUsed: false,
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
      json: async () => {
        throw new Error("not json");
      },
      bytes: async () => new Uint8Array(),
    } as Response;

    fetchMock.mock.mockImplementation(async () => rawResponse);

    const res = await fetchProjects(TEST_CONFIG);

    assert.equal(res.status, 200);
    assert.equal(res.body, "not-json-at-all");
  });

  it("returns null body for empty response text", async () => {
    fetchMock.mock.mockImplementation(async () => fakeResponse(204));

    const res = await removeProject(TEST_CONFIG, "x");

    assert.equal(res.status, 204);
    assert.equal(res.body, null);
  });
});

// ===========================================================================
// Session filtering — pure logic extracted from session list page
// ===========================================================================

describe("session filtering logic", () => {
  interface MinimalSession {
    id: string;
    project?: string;
  }

  function filterSessions(
    sessions: MinimalSession[],
    selectedProject: string | null,
  ): MinimalSession[] {
    if (selectedProject === null) return sessions;
    return sessions.filter((s) => s.project === selectedProject);
  }

  const sessions: MinimalSession[] = [
    { id: "s1", project: "mast" },
    { id: "s2", project: "mast" },
    { id: "s3", project: "other-app" },
    { id: "s4" }, // no project
  ];

  it("returns all sessions when selectedProject is null", () => {
    const result = filterSessions(sessions, null);
    assert.equal(result.length, 4);
    assert.equal(result, sessions); // same reference
  });

  it("filters to matching project", () => {
    const result = filterSessions(sessions, "mast");
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((s) => s.id),
      ["s1", "s2"],
    );
  });

  it("returns empty when no sessions match project", () => {
    const result = filterSessions(sessions, "nonexistent");
    assert.equal(result.length, 0);
  });

  it("does not include sessions with undefined project", () => {
    const result = filterSessions(sessions, "mast");
    assert.ok(result.every((s) => s.project === "mast"));
  });

  it("handles empty sessions array", () => {
    const result = filterSessions([], "mast");
    assert.equal(result.length, 0);
  });
});
