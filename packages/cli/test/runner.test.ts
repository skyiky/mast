/**
 * CLI Runner Tests
 *
 * Tests startCli() — the top-level orchestration flow.
 * Uses dependency injection (fakes) instead of real processes.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startCli, type CliDeps, type CliResult } from "../src/runner.js";
import type { CliConfig } from "../src/args.js";
import type { DetectedProject } from "../src/auto-detect.js";

// --- Fake deps factory ---

function makeFakeDeps(overrides?: Partial<CliDeps>): CliDeps & { logs: string[]; daemonStarted: boolean; daemonStopped: boolean } {
  const state = {
    logs: [] as string[],
    daemonStarted: false,
    daemonStopped: false,
  };

  return {
    log: (msg: string) => state.logs.push(msg),
    autoDetect: async (opts) => ({
      name: "test-project",
      directory: opts.directory,
      isNew: true,
    }),
    startDaemon: async (_opts) => {
      state.daemonStarted = true;
      return {
        shutdown: async () => { state.daemonStopped = true; },
      };
    },
    configDir: "/tmp/test-mast",
    version: "0.0.1-test",
    ...overrides,
    ...state,
    // Re-apply state reference (overrides may clobber)
    get logs() { return state.logs; },
    get daemonStarted() { return state.daemonStarted; },
    get daemonStopped() { return state.daemonStopped; },
  };
}

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    command: "start",
    directory: "/tmp/my-project",
    port: 4096,
    orchestratorUrl: "ws://localhost:3000",
    sandbox: false,
    ...overrides,
  };
}

describe("startCli", () => {
  // ===========================================================================
  // Help command
  // ===========================================================================

  it("prints help text and returns action=help", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ command: "help" });

    const result = await startCli(config, deps);

    assert.equal(result.action, "help");
    assert.equal(deps.daemonStarted, false);
    // Should have printed something containing "usage" or "mast"
    const output = deps.logs.join("\n").toLowerCase();
    assert.ok(output.includes("usage") || output.includes("mast"),
      `Expected help text, got: ${output}`);
  });

  // ===========================================================================
  // Version command
  // ===========================================================================

  it("prints version and returns action=version", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ command: "version" });

    const result = await startCli(config, deps);

    assert.equal(result.action, "version");
    assert.equal(deps.daemonStarted, false);
    const output = deps.logs.join("\n");
    assert.ok(output.includes("0.0.1-test"), `Expected version in output, got: ${output}`);
  });

  // ===========================================================================
  // Start command — happy path
  // ===========================================================================

  it("auto-detects project and starts daemon", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ command: "start", directory: "/tmp/my-project" });

    const result = await startCli(config, deps);

    assert.equal(result.action, "started");
    assert.ok(result.project);
    assert.equal(result.project.name, "test-project");
    assert.equal(deps.daemonStarted, true);
    assert.ok(result.shutdown, "should return a shutdown function");
  });

  it("passes port and orchestratorUrl to startDaemon", async () => {
    let capturedOpts: any = null;
    const deps = makeFakeDeps({
      startDaemon: async (opts) => {
        capturedOpts = opts;
        return { shutdown: async () => {} };
      },
    });
    const config = makeConfig({
      command: "start",
      port: 5555,
      orchestratorUrl: "wss://my-server.com",
    });

    await startCli(config, deps);

    assert.ok(capturedOpts);
    assert.equal(capturedOpts.port, 5555);
    assert.equal(capturedOpts.orchestratorUrl, "wss://my-server.com");
  });

  it("calls autoDetect with the configured directory and configDir", async () => {
    let capturedOpts: any = null;
    const deps = makeFakeDeps({
      autoDetect: async (opts) => {
        capturedOpts = opts;
        return { name: "detected", directory: opts.directory, isNew: false };
      },
    });
    const config = makeConfig({ directory: "/path/to/repo" });

    await startCli(config, deps);

    assert.ok(capturedOpts);
    assert.equal(capturedOpts.directory, "/path/to/repo");
    assert.equal(capturedOpts.configDir, "/tmp/test-mast");
  });

  it("logs project name and status on start", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ command: "start" });

    await startCli(config, deps);

    const output = deps.logs.join("\n").toLowerCase();
    assert.ok(output.includes("test-project"), `Expected project name in output, got: ${output}`);
  });

  // ===========================================================================
  // Start command — auto-detect failure
  // ===========================================================================

  it("propagates autoDetect errors", async () => {
    const deps = makeFakeDeps({
      autoDetect: async () => { throw new Error("Directory does not exist"); },
    });
    const config = makeConfig({ command: "start" });

    await assert.rejects(
      () => startCli(config, deps),
      { message: /does not exist/i },
    );
    assert.equal(deps.daemonStarted, false);
  });

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  it("returned shutdown calls daemon shutdown", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ command: "start" });

    const result = await startCli(config, deps);
    assert.ok(result.shutdown);

    await result.shutdown();
    assert.equal(deps.daemonStopped, true);
  });
});
