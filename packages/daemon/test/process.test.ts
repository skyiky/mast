/**
 * OpenCodeProcess Tests — Phase 5
 *
 * Tests process management: start, stop, restart, crash detection.
 * Uses a mock Node.js script instead of real OpenCode binary.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeProcess } from "../src/opencode-process.js";

// We'll create a mock "opencode" script that:
// - Listens on the given port
// - Responds to GET /global/health with 200
// - Exits on SIGTERM
// - Optionally crashes after a short delay

let tempDir: string;
let mockScriptPath: string;
let proc: OpenCodeProcess | null = null;

// Pick an available port in a safe range to avoid conflicts
let portCounter = 43000 + Math.floor(Math.random() * 2000);
function nextPort(): number {
  return portCounter++;
}

async function setupMockScript(options?: { crashAfterMs?: number }) {
  tempDir = join(tmpdir(), `mast-test-process-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  mockScriptPath = join(tempDir, "mock-opencode.mjs");

  const crashCode = options?.crashAfterMs
    ? `setTimeout(() => { console.log("CRASH"); server.close(() => process.exit(1)); }, ${options.crashAfterMs});`
    : "";

  const script = `
import http from "node:http";

const port = parseInt(process.argv[process.argv.length - 1], 10) || 4096;

const server = http.createServer((req, res) => {
  if (req.url === "/global/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log("Mock OpenCode listening on port " + port);
  ${crashCode}
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
  process.exit(2);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
`;

  await writeFile(mockScriptPath, script, "utf-8");
}

afterEach(async () => {
  if (proc) {
    try {
      await proc.stop();
    } catch {
      // Already stopped
    }
    proc = null;
  }
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
});

// =============================================================================
// Test 18: start() spawns child process, health check passes
// =============================================================================

describe("OpenCodeProcess", () => {
  it("18. start() spawns child process, health check passes", async () => {
    await setupMockScript();
    const port = nextPort();

    proc = new OpenCodeProcess({
      port,
      command: "node",
      args: [mockScriptPath, String(port)],
    });

    await proc.start();
    assert.equal(proc.isRunning(), true, "Process should be running after start");

    // Wait for the mock server to be ready
    await proc.waitForReady(10, 500);

    // Verify health endpoint works
    const res = await fetch(`http://localhost:${port}/global/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });

  // ===========================================================================
  // Test 19: stop() kills child process cleanly
  // ===========================================================================

  it("19. stop() kills child process cleanly", async () => {
    await setupMockScript();
    const port = nextPort();

    proc = new OpenCodeProcess({
      port,
      command: "node",
      args: [mockScriptPath, String(port)],
    });

    await proc.start();
    await proc.waitForReady(10, 500);
    assert.equal(proc.isRunning(), true);

    await proc.stop();
    assert.equal(proc.isRunning(), false, "Process should not be running after stop");

    // Verify the server is actually gone
    try {
      await fetch(`http://localhost:${port}/global/health`);
      assert.fail("Server should not be reachable after stop");
    } catch {
      // Expected — connection refused
    }

    proc = null; // Already stopped, prevent afterEach double-stop
  });

  // ===========================================================================
  // Test 20: restart() kills and re-spawns
  // ===========================================================================

  it("20. restart() kills and re-spawns", async () => {
    await setupMockScript();
    const port = nextPort();

    proc = new OpenCodeProcess({
      port,
      command: "node",
      args: [mockScriptPath, String(port)],
    });

    await proc.start();
    await proc.waitForReady(10, 500);

    // Restart
    await proc.restart();
    assert.equal(proc.isRunning(), true, "Process should be running after restart");

    // Verify health endpoint works after restart
    const res = await fetch(`http://localhost:${port}/global/health`);
    assert.equal(res.status, 200);
  });

  // ===========================================================================
  // Test 21: Process crash detected, onCrash callback fires
  // ===========================================================================

  it("21. crash detected, onCrash callback fires", async () => {
    await setupMockScript({ crashAfterMs: 1000 });
    const port = nextPort();

    let crashCode: number | null = null;
    let crashSignal: string | null = null;
    const crashPromise = new Promise<void>((resolve) => {
      proc = new OpenCodeProcess({
        port,
        command: "node",
        args: [mockScriptPath, String(port)],
        onCrash: (code, signal) => {
          crashCode = code;
          crashSignal = signal;
          resolve();
        },
      });
    });

    await proc!.start();
    await proc!.waitForReady(10, 500);

    // Wait for the crash (mock exits after 1000ms from listen)
    await crashPromise;

    assert.equal(proc!.isRunning(), false, "Process should not be running after crash");
    assert.equal(crashCode, 1, "Exit code should be 1");

    proc = null; // Already stopped
  });

  // ===========================================================================
  // Additional: onCrash is NOT fired during intentional stop
  // ===========================================================================

  it("onCrash is not fired during intentional stop()", async () => {
    await setupMockScript();
    const port = nextPort();

    let crashFired = false;
    proc = new OpenCodeProcess({
      port,
      command: "node",
      args: [mockScriptPath, String(port)],
      onCrash: () => {
        crashFired = true;
      },
    });

    await proc.start();
    await proc.waitForReady(10, 500);

    await proc.stop();

    // Give a moment for any async handlers
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(crashFired, false, "onCrash should NOT fire during intentional stop");
    proc = null;
  });
});
