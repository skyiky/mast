/**
 * Relay Tests — Multi-project routing
 *
 * Tests that the refactored Relay correctly routes requests through
 * ProjectManager to the appropriate OpenCode instances.
 *
 * Architecture:
 *   [Mock Orchestrator WSS] ←→ [Relay] ←→ [ProjectManager] ←→ [Mock OpenCode HTTP servers]
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { Relay } from "../src/relay.js";
import { ProjectConfig } from "../src/project-config.js";
import { ProjectManager } from "../src/project-manager.js";

// --- Helpers ---

let tempDir: string;
let cleanups: Array<() => Promise<void>> = [];

// Port range: 48000+ to avoid collision with other test files
let portCounter = 48000 + Math.floor(Math.random() * 1000);
function nextPort(): number {
  return portCounter++;
}

/**
 * Create a mock OpenCode HTTP server that responds to session endpoints.
 */
function createMockOpenCode(
  port: number,
  sessions: Array<{ id: string; title?: string; directory?: string }>,
): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);

      // GET /session — list sessions
      if (req.method === "GET" && url.pathname === "/session") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sessions));
        return;
      }

      // POST /session — create session (return fake session)
      if (req.method === "POST" && url.pathname === "/session") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const newSession = {
            id: `new-session-${Date.now()}`,
            title: "New Session",
            directory: "/tmp",
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(newSession));
        });
        return;
      }

      // GET /session/:id/message — get messages for sync
      const messageMatch = url.pathname.match(
        /^\/session\/([^/]+)\/message$/,
      );
      if (req.method === "GET" && messageMatch) {
        const sessionId = messageMatch[1];
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
              completed: true,
              createdAt: new Date().toISOString(),
            },
          ]),
        );
        return;
      }

      // POST /session/:id/prompt_async
      const promptMatch = url.pathname.match(
        /^\/session\/([^/]+)\/prompt_async$/,
      );
      if (req.method === "POST" && promptMatch) {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET /global/health
      if (req.method === "GET" && url.pathname === "/global/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(port, () => resolve(server));
  });
}

/**
 * Create a mock orchestrator WSS server.
 * Returns the WSS server and a promise that resolves with the first daemon connection.
 */
function createMockOrchestrator(
  port: number,
): {
  server: http.Server;
  wss: WebSocketServer;
  waitForDaemon: () => Promise<WebSocket>;
} {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer });

  let daemonResolve: ((ws: WebSocket) => void) | null = null;
  const daemonPromise = new Promise<WebSocket>((resolve) => {
    daemonResolve = resolve;
  });

  wss.on("connection", (ws) => {
    // Acknowledge heartbeats
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "heartbeat") {
          ws.send(JSON.stringify({ type: "heartbeat_ack", timestamp: msg.timestamp }));
        }
      } catch {
        // ignore
      }
    });

    if (daemonResolve) {
      daemonResolve(ws);
      daemonResolve = null;
    }
  });

  httpServer.listen(port);

  return {
    server: httpServer,
    wss,
    waitForDaemon: () => daemonPromise,
  };
}

/**
 * Send an http_request message to the daemon via WSS and wait for the response.
 */
async function sendRequest(
  daemonWs: WebSocket,
  request: {
    method: string;
    path: string;
    body?: unknown;
    query?: Record<string, string>;
  },
  timeoutMs = 5000,
): Promise<{ status: number; body: unknown }> {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out: ${request.method} ${request.path}`));
    }, timeoutMs);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "http_response" && msg.requestId === requestId) {
          clearTimeout(timer);
          daemonWs.off("message", handler);
          resolve({ status: msg.status, body: msg.body });
        }
      } catch {
        // ignore non-json
      }
    };

    daemonWs.on("message", handler);

    daemonWs.send(
      JSON.stringify({
        type: "http_request",
        requestId,
        ...request,
      }),
    );
  });
}

// --- Setup / Teardown ---

beforeEach(async () => {
  tempDir = join(tmpdir(), `mast-test-relay-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  cleanups = [];
});

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      // best effort
    }
  }
  cleanups = [];
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

/**
 * Helper to set up a full relay test environment:
 *   - 2 mock OpenCode servers with different sessions
 *   - 1 mock orchestrator WSS server
 *   - 1 ProjectManager with 2 projects
 *   - 1 Relay connected to the orchestrator
 *
 * Returns the daemon WSS connection (from orchestrator side) for sending requests.
 */
async function setupRelayEnv() {
  const ocPort1 = nextPort();
  const ocPort2 = nextPort();
  const orchPort = nextPort();

  // Mock OpenCode servers
  const sessions1 = [
    { id: "s1", title: "Session 1", directory: "C:\\proj\\alpha" },
    { id: "s2", title: "Session 2", directory: "C:\\proj\\alpha" },
  ];
  const sessions2 = [
    { id: "s3", title: "Session 3", directory: "C:\\proj\\beta" },
  ];

  const oc1 = await createMockOpenCode(ocPort1, sessions1);
  const oc2 = await createMockOpenCode(ocPort2, sessions2);
  cleanups.push(
    () => new Promise<void>((r) => oc1.close(() => r())),
    () => new Promise<void>((r) => oc2.close(() => r())),
  );

  // Mock orchestrator
  const orch = createMockOrchestrator(orchPort);
  cleanups.push(
    () => new Promise<void>((r) => orch.server.close(() => r())),
  );

  // Project config
  const configDir = join(tempDir, "config");
  await mkdir(configDir, { recursive: true });
  const projectConfig = new ProjectConfig(configDir);
  await projectConfig.save([
    { name: "alpha", directory: "C:\\proj\\alpha" },
    { name: "beta", directory: "C:\\proj\\beta" },
  ]);

  // ProjectManager
  const projectManager = new ProjectManager(projectConfig, {
    basePort: ocPort1,
    skipOpenCode: true,
  });

  // Start projects — since skipOpenCode=true, this just registers them
  // But we need to ensure ports match the mock servers
  // The ProjectManager allocates ports sequentially from basePort,
  // so project "alpha" gets ocPort1 and "beta" gets ocPort1+1 = ocPort2
  await projectManager.startAll();

  // Create relay and connect
  const relay = new Relay(
    `ws://localhost:${orchPort}`,
    projectManager,
    "test-key",
  );
  cleanups.push(async () => {
    await relay.disconnect();
    await projectManager.stopAll();
  });

  await relay.connect();

  // Wait for daemon to connect to orchestrator
  const daemonWs = await orch.waitForDaemon();

  // Wait a beat for the status message to arrive
  await new Promise((r) => setTimeout(r, 100));

  return { daemonWs, relay, projectManager, sessions1, sessions2 };
}

// =============================================================================
// Tests
// =============================================================================

describe("Relay routing: GET /session", () => {
  it("aggregates sessions from all projects", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "GET",
      path: "/session",
    });

    assert.equal(res.status, 200);
    const sessions = res.body as Array<{ id: string; project: string }>;
    assert.equal(sessions.length, 3, "Should have 3 sessions total");

    // Check enrichment
    const s1 = sessions.find((s) => s.id === "s1");
    assert.ok(s1, "Session s1 should exist");
    assert.equal(s1!.project, "alpha");

    const s3 = sessions.find((s) => s.id === "s3");
    assert.ok(s3, "Session s3 should exist");
    assert.equal(s3!.project, "beta");
  });
});

describe("Relay routing: POST /session", () => {
  it("routes to specified project", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/session",
      body: { project: "beta" },
    });

    assert.equal(res.status, 200);
    const body = res.body as { id: string };
    assert.ok(body.id, "Should return new session with id");
  });

  it("auto-routes when only one project exists", async () => {
    // Set up a single-project environment
    const ocPort = nextPort();
    const orchPort = nextPort();

    const oc = await createMockOpenCode(ocPort, []);
    cleanups.push(() => new Promise<void>((r) => oc.close(() => r())));

    const orch = createMockOrchestrator(orchPort);
    cleanups.push(
      () => new Promise<void>((r) => orch.server.close(() => r())),
    );

    const configDir = join(tempDir, "config-single");
    await mkdir(configDir, { recursive: true });
    const projectConfig = new ProjectConfig(configDir);
    await projectConfig.save([{ name: "solo", directory: "C:\\proj\\solo" }]);

    const pm = new ProjectManager(projectConfig, {
      basePort: ocPort,
      skipOpenCode: true,
    });
    await pm.startAll();

    const relay = new Relay(`ws://localhost:${orchPort}`, pm, "test-key");
    cleanups.push(async () => {
      await relay.disconnect();
      await pm.stopAll();
    });

    await relay.connect();
    const daemonWs = await orch.waitForDaemon();
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/session",
      body: {}, // No project specified
    });

    assert.equal(res.status, 200);
    const body = res.body as { id: string };
    assert.ok(body.id);
  });

  it("returns 400 when project not specified and multiple projects exist", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/session",
      body: {}, // No project specified
    });

    assert.equal(res.status, 400);
    const body = res.body as { error: string };
    assert.ok(body.error.includes("No project"));
  });
});

describe("Relay routing: /session/:id/*", () => {
  it("routes prompt to correct project by session ID", async () => {
    const { daemonWs } = await setupRelayEnv();

    // First, list sessions to populate the routing map
    await sendRequest(daemonWs, { method: "GET", path: "/session" });

    // Now send a prompt to session s3 (owned by beta)
    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/session/s3/prompt_async",
      body: { parts: [{ type: "text", text: "hello" }] },
    });

    assert.equal(res.status, 204);
  });

  it("returns 404 for unknown session ID", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "GET",
      path: "/session/nonexistent/message",
    });

    // It should try refreshing sessions, then return 404
    assert.equal(res.status, 404);
    const body = res.body as { error: string };
    assert.ok(body.error.includes("not found"));
  });
});

describe("Relay routing: /project", () => {
  it("GET /project lists managed projects", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "GET",
      path: "/project",
    });

    assert.equal(res.status, 200);
    const projects = res.body as Array<{
      name: string;
      directory: string;
      port: number;
      ready: boolean;
    }>;
    assert.equal(projects.length, 2);
    assert.ok(projects.find((p) => p.name === "alpha"));
    assert.ok(projects.find((p) => p.name === "beta"));
  });

  it("POST /project adds a new project", async () => {
    const { daemonWs } = await setupRelayEnv();

    // Start a mock OpenCode for the new project
    const newPort = nextPort();
    const oc = await createMockOpenCode(newPort, []);
    cleanups.push(() => new Promise<void>((r) => oc.close(() => r())));

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/project",
      body: { name: "gamma", directory: "C:\\proj\\gamma" },
    });

    assert.equal(res.status, 201);
    const body = res.body as { name: string; ready: boolean };
    assert.equal(body.name, "gamma");
    assert.equal(body.ready, true);
  });

  it("POST /project returns 409 for duplicate", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/project",
      body: { name: "alpha", directory: "C:\\proj\\elsewhere" },
    });

    assert.equal(res.status, 409);
  });

  it("POST /project returns 400 for missing fields", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "POST",
      path: "/project",
      body: { name: "nodir" },
    });

    assert.equal(res.status, 400);
  });

  it("DELETE /project/:name removes a project", async () => {
    const { daemonWs, projectManager } = await setupRelayEnv();

    assert.equal(projectManager.listProjects().length, 2);

    const res = await sendRequest(daemonWs, {
      method: "DELETE",
      path: "/project/beta",
    });

    assert.equal(res.status, 200);
    const body = res.body as { removed: string };
    assert.equal(body.removed, "beta");
    assert.equal(projectManager.listProjects().length, 1);
  });

  it("DELETE /project/:name returns 404 for unknown project", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "DELETE",
      path: "/project/nonexistent",
    });

    assert.equal(res.status, 404);
  });
});

describe("Relay routing: fallback", () => {
  it("forwards /global/health to first ready project", async () => {
    const { daemonWs } = await setupRelayEnv();

    const res = await sendRequest(daemonWs, {
      method: "GET",
      path: "/global/health",
    });

    assert.equal(res.status, 200);
    const body = res.body as { status: string };
    assert.equal(body.status, "ok");
  });

  it("returns 503 when no projects are ready", async () => {
    const orchPort = nextPort();

    const orch = createMockOrchestrator(orchPort);
    cleanups.push(
      () => new Promise<void>((r) => orch.server.close(() => r())),
    );

    const configDir = join(tempDir, "config-empty");
    await mkdir(configDir, { recursive: true });
    const projectConfig = new ProjectConfig(configDir);
    await projectConfig.save([]); // no projects

    const pm = new ProjectManager(projectConfig, {
      basePort: nextPort(),
      skipOpenCode: true,
    });

    const relay = new Relay(`ws://localhost:${orchPort}`, pm, "test-key");
    cleanups.push(async () => {
      await relay.disconnect();
      await pm.stopAll();
    });

    await relay.connect();
    const daemonWs = await orch.waitForDaemon();
    await new Promise((r) => setTimeout(r, 100));

    const res = await sendRequest(daemonWs, {
      method: "GET",
      path: "/global/health",
    });

    assert.equal(res.status, 503);
  });
});

describe("Relay: initial status", () => {
  it("sends opencodeReady status on connect", async () => {
    const orchPort = nextPort();
    const orch = createMockOrchestrator(orchPort);
    cleanups.push(
      () => new Promise<void>((r) => orch.server.close(() => r())),
    );

    const configDir = join(tempDir, "config-status");
    await mkdir(configDir, { recursive: true });
    const projectConfig = new ProjectConfig(configDir);
    await projectConfig.save([
      { name: "proj", directory: "C:\\proj" },
    ]);

    const pm = new ProjectManager(projectConfig, {
      basePort: nextPort(),
      skipOpenCode: true,
    });
    await pm.startAll();

    const relay = new Relay(`ws://localhost:${orchPort}`, pm, "test-key");
    cleanups.push(async () => {
      await relay.disconnect();
      await pm.stopAll();
    });

    // Capture the first message (should be status)
    const statusPromise = new Promise<{ type: string; opencodeReady: boolean }>((resolve) => {
      const daemonPromise = orch.waitForDaemon();
      daemonPromise.then((ws) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "status") {
            resolve(msg);
          }
        });
      });
    });

    await relay.connect();

    const status = await statusPromise;
    assert.equal(status.type, "status");
    assert.equal(status.opencodeReady, true);
  });
});

describe("Relay: sync", () => {
  it("handles sync_request by routing to correct projects", async () => {
    const { daemonWs } = await setupRelayEnv();

    // First list sessions to populate routing map
    await sendRequest(daemonWs, { method: "GET", path: "/session" });

    // Send sync_request from orchestrator to daemon
    const syncResponse = await new Promise<{
      type: string;
      sessions: Array<{ id: string; messages: unknown[] }>;
    }>((resolve) => {
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "sync_response") {
          daemonWs.off("message", handler);
          resolve(msg);
        }
      };
      daemonWs.on("message", handler);

      daemonWs.send(
        JSON.stringify({
          type: "sync_request",
          cachedSessionIds: ["s1", "s3"],
          lastEventTimestamp: new Date(0).toISOString(), // very old → include all
        }),
      );
    });

    assert.equal(syncResponse.type, "sync_response");
    assert.equal(syncResponse.sessions.length, 2, "Should have 2 sessions with messages");

    const s1 = syncResponse.sessions.find((s) => s.id === "s1");
    assert.ok(s1, "s1 should have messages");
    assert.ok(s1!.messages.length > 0);

    const s3 = syncResponse.sessions.find((s) => s.id === "s3");
    assert.ok(s3, "s3 should have messages");
    assert.ok(s3!.messages.length > 0);
  });
});
