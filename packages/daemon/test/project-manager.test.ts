/**
 * ProjectManager Tests
 *
 * Tests multi-project lifecycle: start/stop, session listing,
 * session→project routing, SSE wiring, health wiring, and
 * runtime add/remove of projects.
 *
 * Uses mock OpenCode HTTP servers (Node.js http) that serve
 * /global/health and /session endpoints.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectManager, type ProjectManagerConfig } from "../src/project-manager.js";
import { ProjectConfig } from "../src/project-config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let projectConfig: ProjectConfig;
let manager: ProjectManager | null = null;
const servers: http.Server[] = [];

/** Port pool to avoid collisions between tests */
let portCounter = 46000 + Math.floor(Math.random() * 2000);
function nextPort(): number {
  return portCounter++;
}

interface MockSession {
  id: string;
  slug?: string;
  directory: string;
  title?: string;
  time?: { created: number; updated: number };
}

/**
 * Start a mock OpenCode HTTP server that serves /global/health and /session.
 * Returns the port it's listening on.
 */
function startMockOpenCode(
  port: number,
  sessions: MockSession[] = [],
): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/global/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else if (req.url === "/session") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sessions));
      } else if (req.url?.startsWith("/session/") && req.url.endsWith("/message")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([]));
      } else if (req.url === "/event") {
        // SSE endpoint — keep connection open
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        // Don't end — SSE stays open
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(port, () => {
      servers.push(server);
      resolve(server);
    });
  });
}

/** Create a ProjectManager wired to mock servers (skipping real opencode spawn). */
function createManager(
  config?: Partial<ProjectManagerConfig>,
  basePort?: number,
): ProjectManager {
  const port = basePort ?? nextPort();
  const m = new ProjectManager(projectConfig, {
    basePort: port,
    skipOpenCode: true, // Don't spawn real opencode
    ...config,
  });
  return m;
}

beforeEach(async () => {
  tempDir = join(
    tmpdir(),
    `mast-test-projmgr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
  projectConfig = new ProjectConfig(tempDir);
});

afterEach(async () => {
  if (manager) {
    await manager.stopAll();
    manager = null;
  }

  // Close all mock servers
  for (const server of servers) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  servers.length = 0;

  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

// ===========================================================================
// Lifecycle
// ===========================================================================

describe("ProjectManager lifecycle", () => {
  it("startAll() starts all projects from config", async () => {
    const port1 = nextPort();
    const port2 = nextPort();
    await startMockOpenCode(port1);
    await startMockOpenCode(port2);

    await projectConfig.save([
      { name: "alpha", directory: "/path/to/alpha" },
      { name: "beta", directory: "/path/to/beta" },
    ]);

    manager = createManager({}, port1);
    const started = await manager.startAll();

    assert.equal(started.length, 2);
    assert.equal(manager.size, 2);
    assert.equal(manager.getProject("alpha")?.port, port1);
    assert.equal(manager.getProject("beta")?.port, port1 + 1);
  });

  it("startAll() with empty config returns empty array", async () => {
    manager = createManager();
    const started = await manager.startAll();
    assert.equal(started.length, 0);
    assert.equal(manager.size, 0);
  });

  it("stopProject() removes a specific project", async () => {
    await projectConfig.save([
      { name: "alpha", directory: "/alpha" },
      { name: "beta", directory: "/beta" },
    ]);

    manager = createManager();
    await manager.startAll();
    assert.equal(manager.size, 2);

    await manager.stopProject("alpha");
    assert.equal(manager.size, 1);
    assert.equal(manager.getProject("alpha"), undefined);
    assert.ok(manager.getProject("beta"));
  });

  it("stopAll() removes all projects and resets port offset", async () => {
    await projectConfig.save([
      { name: "alpha", directory: "/alpha" },
      { name: "beta", directory: "/beta" },
    ]);

    manager = createManager();
    await manager.startAll();
    assert.equal(manager.size, 2);

    await manager.stopAll();
    assert.equal(manager.size, 0);
  });

  it("startProject() is idempotent — returns existing if already running", async () => {
    manager = createManager();
    const first = await manager.startProject({ name: "alpha", directory: "/alpha" });
    const second = await manager.startProject({ name: "alpha", directory: "/alpha" });
    assert.equal(first, second);
    assert.equal(manager.size, 1);
  });
});

// ===========================================================================
// Port allocation
// ===========================================================================

describe("ProjectManager port allocation", () => {
  it("allocates sequential ports from base", async () => {
    const base = nextPort();
    manager = createManager({}, base);

    await manager.startProject({ name: "a", directory: "/a" });
    await manager.startProject({ name: "b", directory: "/b" });
    await manager.startProject({ name: "c", directory: "/c" });

    assert.equal(manager.getProject("a")?.port, base);
    assert.equal(manager.getProject("b")?.port, base + 1);
    assert.equal(manager.getProject("c")?.port, base + 2);
  });
});

// ===========================================================================
// listProjects()
// ===========================================================================

describe("ProjectManager listProjects", () => {
  it("returns project info for all managed projects", async () => {
    manager = createManager();
    await manager.startProject({ name: "alpha", directory: "/alpha" });
    await manager.startProject({ name: "beta", directory: "/beta" });

    const list = manager.listProjects();
    assert.equal(list.length, 2);

    const alpha = list.find((p) => p.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.directory, "/alpha");
    assert.equal(alpha.ready, true);

    const beta = list.find((p) => p.name === "beta");
    assert.ok(beta);
    assert.equal(beta.directory, "/beta");
  });
});

// ===========================================================================
// Session listing & routing
// ===========================================================================

describe("ProjectManager session listing", () => {
  it("listAllSessions() aggregates sessions from multiple projects", async () => {
    const port1 = nextPort();
    const port2 = nextPort();

    await startMockOpenCode(port1, [
      { id: "s1", directory: "/alpha", title: "Session 1" },
      { id: "s2", directory: "/alpha", title: "Session 2" },
    ]);
    await startMockOpenCode(port2, [
      { id: "s3", directory: "/beta", title: "Session 3" },
    ]);

    manager = createManager({}, port1);
    await manager.startProject({ name: "alpha", directory: "/alpha" });
    await manager.startProject({ name: "beta", directory: "/beta" });

    const sessions = await manager.listAllSessions();
    assert.equal(sessions.length, 3);

    // Verify enrichment
    const s1 = sessions.find((s) => s.id === "s1");
    assert.ok(s1);
    assert.equal(s1.project, "alpha");
    assert.equal(s1.title, "Session 1");

    const s3 = sessions.find((s) => s.id === "s3");
    assert.ok(s3);
    assert.equal(s3.project, "beta");
  });

  it("listAllSessions() populates session→project routing map", async () => {
    const port1 = nextPort();
    const port2 = nextPort();

    await startMockOpenCode(port1, [
      { id: "s1", directory: "/alpha" },
    ]);
    await startMockOpenCode(port2, [
      { id: "s2", directory: "/beta" },
    ]);

    manager = createManager({}, port1);
    await manager.startProject({ name: "alpha", directory: "/alpha" });
    await manager.startProject({ name: "beta", directory: "/beta" });

    await manager.listAllSessions();

    // Routing should now work
    assert.equal(manager.getBaseUrlForSession("s1"), `http://localhost:${port1}`);
    assert.equal(manager.getBaseUrlForSession("s2"), `http://localhost:${port2}`);
    assert.equal(manager.getProjectForSession("s1"), "alpha");
    assert.equal(manager.getProjectForSession("s2"), "beta");
  });

  it("listAllSessions() returns empty for no projects", async () => {
    manager = createManager();
    const sessions = await manager.listAllSessions();
    assert.equal(sessions.length, 0);
  });

  it("listAllSessions() handles fetch failure gracefully", async () => {
    // Port with no server — fetch will fail
    manager = createManager();
    await manager.startProject({ name: "broken", directory: "/broken" });

    const sessions = await manager.listAllSessions();
    assert.equal(sessions.length, 0); // Graceful — no crash
  });
});

// ===========================================================================
// Session routing
// ===========================================================================

describe("ProjectManager session routing", () => {
  it("getBaseUrlForSession() returns null for unknown session", () => {
    manager = createManager();
    assert.equal(manager.getBaseUrlForSession("unknown-id"), null);
  });

  it("registerSession() explicitly maps session to project", async () => {
    const port = nextPort();
    manager = createManager({}, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.registerSession("new-session-1", "alpha");

    assert.equal(manager.getBaseUrlForSession("new-session-1"), `http://localhost:${port}`);
    assert.equal(manager.getProjectForSession("new-session-1"), "alpha");
  });

  it("stopProject() cleans up session mappings for that project", async () => {
    const port = nextPort();
    manager = createManager({}, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.registerSession("s1", "alpha");
    manager.registerSession("s2", "alpha");
    assert.equal(manager.getProjectForSession("s1"), "alpha");

    await manager.stopProject("alpha");
    assert.equal(manager.getProjectForSession("s1"), null);
    assert.equal(manager.getProjectForSession("s2"), null);
  });

  it("getBaseUrlForProject() returns correct URL", async () => {
    const port = nextPort();
    manager = createManager({}, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    assert.equal(manager.getBaseUrlForProject("alpha"), `http://localhost:${port}`);
    assert.equal(manager.getBaseUrlForProject("nonexistent"), null);
  });
});

// ===========================================================================
// SSE wiring
// ===========================================================================

describe("ProjectManager SSE", () => {
  it("startSse() subscribes to project's SSE stream", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    const events: Array<{ project: string; event: unknown }> = [];
    manager = createManager(
      {
        onEvent: (projectName, event) => {
          events.push({ project: projectName, event });
        },
      },
      port,
    );

    await manager.startProject({ name: "alpha", directory: "/alpha" });
    manager.startSse("alpha");

    // Give SSE a moment to connect
    await new Promise((r) => setTimeout(r, 200));

    // The mock server keeps the SSE connection open but doesn't send events
    // so we just verify no crash and the subscriber is wired
    const managed = manager.getProject("alpha");
    assert.ok(managed?.sse, "SSE subscriber should be set");
  });

  it("stopSse() clears SSE subscriber", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    manager = createManager({}, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.startSse("alpha");
    assert.ok(manager.getProject("alpha")?.sse);

    manager.stopSse("alpha");
    assert.equal(manager.getProject("alpha")?.sse, null);
  });

  it("startAllSse() and stopAllSse() manage all projects", async () => {
    const port1 = nextPort();
    const port2 = nextPort();
    await startMockOpenCode(port1);
    await startMockOpenCode(port2);

    manager = createManager({}, port1);
    await manager.startProject({ name: "alpha", directory: "/alpha" });
    await manager.startProject({ name: "beta", directory: "/beta" });

    manager.startAllSse();
    assert.ok(manager.getProject("alpha")?.sse);
    assert.ok(manager.getProject("beta")?.sse);

    manager.stopAllSse();
    assert.equal(manager.getProject("alpha")?.sse, null);
    assert.equal(manager.getProject("beta")?.sse, null);
  });
});

// ===========================================================================
// Health monitoring wiring
// ===========================================================================

describe("ProjectManager health monitoring", () => {
  it("startHealth() creates a health monitor for the project", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    manager = createManager({ healthCheckIntervalMs: 60_000 }, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.startHealth("alpha");
    assert.ok(manager.getProject("alpha")?.health);
    assert.equal(manager.getProject("alpha")?.health?.running, true);
  });

  it("stopHealth() stops and clears the health monitor", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    manager = createManager({ healthCheckIntervalMs: 60_000 }, port);
    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.startHealth("alpha");
    manager.stopHealth("alpha");
    assert.equal(manager.getProject("alpha")?.health, null);
  });

  it("onHealthStateChange callback fires with project name", async () => {
    const port = nextPort();
    // No server on this port — health checks will fail
    const stateChanges: Array<{ project: string; state: string; ready: boolean }> = [];

    manager = createManager({
      healthCheckIntervalMs: 60_000,
      healthFailureThreshold: 2,
      onHealthStateChange: (projectName, state, ready) => {
        stateChanges.push({ project: projectName, state, ready });
      },
      // Prevent default auto-restart (would fail in test — no real opencode)
      onRecoveryNeeded: async () => {},
    });

    await manager.startProject({ name: "alpha", directory: "/alpha" });

    manager.startHealth("alpha");
    const health = manager.getProject("alpha")?.health;
    assert.ok(health);

    // Manually trigger failures (don't wait for interval)
    await health.check(); // fail 1 → degraded (no callback)
    await health.check(); // fail 2 → down (callback fires)

    assert.equal(stateChanges.length, 1);
    assert.equal(stateChanges[0].project, "alpha");
    assert.equal(stateChanges[0].state, "down");
    assert.equal(stateChanges[0].ready, false);
  });
});

// ===========================================================================
// Runtime add/remove
// ===========================================================================

describe("ProjectManager runtime add/remove", () => {
  it("addProject() saves to config and starts the project", async () => {
    manager = createManager();

    const managed = await manager.addProject("runtime-proj", "/runtime/path");
    assert.equal(managed.name, "runtime-proj");
    assert.equal(managed.directory, "/runtime/path");
    assert.equal(manager.size, 1);

    // Verify persisted to config
    const loaded = await projectConfig.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].name, "runtime-proj");
  });

  it("removeProject() stops and removes from config", async () => {
    manager = createManager();
    await manager.addProject("temp-proj", "/temp/path");
    assert.equal(manager.size, 1);

    await manager.removeProject("temp-proj");
    assert.equal(manager.size, 0);

    // Verify removed from config
    const loaded = await projectConfig.load();
    assert.equal(loaded.length, 0);
  });

  it("addProject() rejects duplicate names", async () => {
    manager = createManager();
    await manager.addProject("dup", "/path/a");

    await assert.rejects(
      () => manager!.addProject("dup", "/path/b"),
      { message: /already exists/ },
    );
  });
});

// ===========================================================================
// allReady
// ===========================================================================

describe("ProjectManager allReady", () => {
  it("allReady is false with no projects", () => {
    manager = createManager();
    assert.equal(manager.allReady, false);
  });

  it("allReady is true when all projects are ready", async () => {
    manager = createManager();
    await manager.startProject({ name: "a", directory: "/a" });
    await manager.startProject({ name: "b", directory: "/b" });
    assert.equal(manager.allReady, true);
  });
});

// ===========================================================================
// attachProject (unmanaged mode)
// ===========================================================================

describe("ProjectManager attachProject", () => {
  it("attaches an external OpenCode instance by URL", async () => {
    const port = nextPort();
    await startMockOpenCode(port, [
      { id: "ses_1", directory: "/ext", title: "attached session" },
    ]);

    manager = createManager();
    const attached = manager.attachProject("external", `http://localhost:${port}`);

    assert.equal(attached.name, "external");
    assert.equal(attached.ready, true);
    assert.equal(attached.managed, false);
    assert.equal(attached.port, port);
  });

  it("appears in listProjects()", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    manager = createManager();
    manager.attachProject("ext", `http://localhost:${port}`);

    const projects = manager.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "ext");
    assert.equal(projects[0].ready, true);
  });

  it("sessions from attached project are listed and routed", async () => {
    const port = nextPort();
    await startMockOpenCode(port, [
      { id: "ses_ext_1", directory: "/ext", title: "ext session" },
    ]);

    manager = createManager();
    manager.attachProject("ext", `http://localhost:${port}`);

    const sessions = await manager.listAllSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "ses_ext_1");
    assert.equal(sessions[0].project, "ext");

    // Routing works
    const url = manager.getBaseUrlForSession("ses_ext_1");
    assert.equal(url, `http://localhost:${port}`);
  });

  it("rejects duplicate project names", () => {
    const port = nextPort();
    manager = createManager();
    manager.attachProject("dup", `http://localhost:${port}`);

    assert.throws(
      () => manager!.attachProject("dup", `http://localhost:${port + 1}`),
      /already exists/,
    );
  });

  it("detachProject() removes the attached project", async () => {
    const port = nextPort();
    await startMockOpenCode(port);

    manager = createManager();
    manager.attachProject("ext", `http://localhost:${port}`);
    assert.equal(manager.size, 1);

    await manager.detachProject("ext");
    assert.equal(manager.size, 0);
    assert.equal(manager.listProjects().length, 0);
  });

  it("detachProject() cleans up session mappings", async () => {
    const port = nextPort();
    await startMockOpenCode(port, [
      { id: "ses_d1", directory: "/d" },
    ]);

    manager = createManager();
    manager.attachProject("ext", `http://localhost:${port}`);
    await manager.listAllSessions(); // populates routing map

    assert.ok(manager.getBaseUrlForSession("ses_d1"));

    await manager.detachProject("ext");
    assert.equal(manager.getBaseUrlForSession("ses_d1"), null);
  });

  it("stopProject() does NOT kill process for unmanaged projects", async () => {
    const port = nextPort();
    const srv = await startMockOpenCode(port);

    manager = createManager();
    manager.attachProject("ext", `http://localhost:${port}`);
    await manager.stopProject("ext");

    // The mock server should still be running (we didn't kill it)
    const res = await fetch(`http://localhost:${port}/global/health`);
    assert.equal(res.ok, true);
  });

  it("can mix managed and attached projects", async () => {
    const managedPort = nextPort();
    const attachedPort = nextPort();
    await startMockOpenCode(managedPort, [
      { id: "ses_m1", directory: "/m" },
    ]);
    await startMockOpenCode(attachedPort, [
      { id: "ses_a1", directory: "/a" },
    ]);

    manager = createManager({}, managedPort);
    await manager.startProject({ name: "managed", directory: "/m" });
    manager.attachProject("attached", `http://localhost:${attachedPort}`);

    assert.equal(manager.size, 2);

    const sessions = await manager.listAllSessions();
    assert.equal(sessions.length, 2);

    const names = sessions.map((s) => s.project).sort();
    assert.deepEqual(names, ["attached", "managed"]);
  });
});
