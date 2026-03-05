/**
 * CLI Config Integration Tests
 *
 * Tests that startCli() auto-saves and auto-reads the orchestrator URL
 * from ~/.mast/config.json via loadConfigUrl / saveConfigUrl deps.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startCli, type CliDeps } from "../src/runner.js";
import type { CliConfig } from "../src/args.js";

function makeFakeDeps(overrides?: Partial<CliDeps>): CliDeps & { logs: string[]; savedUrl: string | undefined } {
  const state = {
    logs: [] as string[],
    savedUrl: undefined as string | undefined,
  };

  return {
    log: (msg: string) => state.logs.push(msg),
    autoDetect: async (opts) => ({
      name: "test-project",
      directory: opts.directory,
      isNew: false,
    }),
    startDaemon: async () => ({
      shutdown: async () => {},
    }),
    startOrchestrator: async (opts: any) => ({
      port: opts.port ?? 3000,
      shutdown: async () => {},
    }),
    discoverOpenCode: async () => [],
    attachDaemon: async () => ({
      shutdown: async () => {},
    }),
    loadConfigUrl: async () => undefined,
    saveConfigUrl: async (url) => { state.savedUrl = url; },
    configDir: "/tmp/test-mast",
    version: "0.0.1-test",
    ...overrides,
    ...state,
    get logs() { return state.logs; },
    get savedUrl() { return state.savedUrl; },
  };
}

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    command: "start",
    directory: "/tmp/my-project",
    port: 4096,
    orchestratorUrl: "",
    sandbox: false,
    ...overrides,
  };
}

// =============================================================================
// Auto-save: CLI flag → config
// =============================================================================

describe("config auto-save", () => {
  it("saves orchestratorUrl to config when CLI flag is provided", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ orchestratorUrl: "wss://my-orch.com" });

    await startCli(config, deps);

    assert.equal(deps.savedUrl, "wss://my-orch.com");
  });

  it("does NOT save when no orchestratorUrl flag", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ orchestratorUrl: "" });

    await startCli(config, deps);

    assert.equal(deps.savedUrl, undefined);
  });

  it("logs that URL was saved", async () => {
    const deps = makeFakeDeps();
    const config = makeConfig({ orchestratorUrl: "wss://saved.io" });

    await startCli(config, deps);

    const output = deps.logs.join("\n").toLowerCase();
    assert.ok(output.includes("saved"), `Expected 'saved' in logs, got: ${output}`);
  });
});

// =============================================================================
// Auto-read: config → orchestrator URL
// =============================================================================

describe("config auto-read", () => {
  it("uses saved URL when no CLI flag is provided", async () => {
    let capturedOpts: any = null;
    const deps = makeFakeDeps({
      loadConfigUrl: async () => "wss://from-config.io",
      startDaemon: async (opts) => {
        capturedOpts = opts;
        return { shutdown: async () => {} };
      },
    });
    const config = makeConfig({ orchestratorUrl: "" });

    await startCli(config, deps);

    assert.ok(capturedOpts);
    assert.equal(capturedOpts.orchestratorUrl, "wss://from-config.io");
    assert.equal(capturedOpts.embedded, false);
  });

  it("falls back to embedded when config has no URL either", async () => {
    let orchestratorStarted = false;
    const deps = makeFakeDeps({
      loadConfigUrl: async () => undefined,
      startOrchestrator: async (opts) => {
        orchestratorStarted = true;
        return { port: opts.port, shutdown: async () => {} };
      },
    });
    const config = makeConfig({ orchestratorUrl: "" });

    await startCli(config, deps);

    assert.equal(orchestratorStarted, true);
  });

  it("CLI flag takes precedence over saved config", async () => {
    let capturedOpts: any = null;
    const deps = makeFakeDeps({
      loadConfigUrl: async () => "wss://old-config.io",
      startDaemon: async (opts) => {
        capturedOpts = opts;
        return { shutdown: async () => {} };
      },
    });
    const config = makeConfig({ orchestratorUrl: "wss://cli-flag.io" });

    await startCli(config, deps);

    assert.ok(capturedOpts);
    assert.equal(capturedOpts.orchestratorUrl, "wss://cli-flag.io");
  });

  it("logs when using saved URL", async () => {
    const deps = makeFakeDeps({
      loadConfigUrl: async () => "wss://from-config.io",
    });
    const config = makeConfig({ orchestratorUrl: "" });

    await startCli(config, deps);

    const output = deps.logs.join("\n").toLowerCase();
    assert.ok(output.includes("saved") || output.includes("config"),
      `Expected config-related log, got: ${output}`);
  });
});

// =============================================================================
// Attach command also uses config
// =============================================================================

describe("attach config integration", () => {
  it("saves orchestratorUrl for attach command", async () => {
    const deps = makeFakeDeps({
      attachDaemon: async () => ({ shutdown: async () => {} }),
    });
    const config = makeConfig({
      command: "attach",
      attachUrl: "http://localhost:4096",
      orchestratorUrl: "wss://attach-orch.io",
    });

    await startCli(config, deps);

    assert.equal(deps.savedUrl, "wss://attach-orch.io");
  });

  it("reads saved URL for attach command when no flag", async () => {
    let capturedOpts: any = null;
    const deps = makeFakeDeps({
      loadConfigUrl: async () => "wss://saved-for-attach.io",
      attachDaemon: async (opts) => {
        capturedOpts = opts;
        return { shutdown: async () => {} };
      },
    });
    const config = makeConfig({
      command: "attach",
      attachUrl: "http://localhost:4096",
      orchestratorUrl: "",
    });

    await startCli(config, deps);

    assert.ok(capturedOpts);
    assert.equal(capturedOpts.orchestratorUrl, "wss://saved-for-attach.io");
    assert.equal(capturedOpts.embedded, false);
  });
});
