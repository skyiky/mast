#!/usr/bin/env node

/**
 * CLI entry point — wires real dependencies into startCli().
 *
 * This is the production entry point for `npx mast`.
 * All side-effectful operations (fs, spawn, network) are resolved here
 * and injected into the runner, keeping the runner itself testable.
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCliArgs } from "./args.js";
import { autoDetect } from "./auto-detect.js";
import { startCli } from "./runner.js";
import { startServer } from "@mast/orchestrator/server";
import { ProjectConfig } from "@mast/daemon/project-config";
import { ProjectManager } from "@mast/daemon/project-manager";
import { Relay, AuthError } from "@mast/daemon/relay";
import { KeyStore } from "@mast/daemon/key-store";
import { runPairingFlow } from "@mast/daemon/pairing-flow";
import { discoverOpenCode } from "@mast/daemon/discover";
import type { DaemonStatus, EventMessage } from "@mast/shared";
import type { DetectedProject } from "./auto-detect.js";

// Make the CLI process identifiable
process.title = "mast-cli";

const VERSION = "0.0.1";
const CONFIG_DIR = join(homedir(), ".mast");

/**
 * Resolve the web client dist path at runtime.
 *
 * - Monorepo dev (tsx):  import.meta.dirname = packages/cli/src
 *   → ../../web/dist = packages/web/dist
 * - Bundled (dist/cli.mjs): import.meta.dirname = packages/cli/dist
 *   → ../../web/dist = packages/web/dist  (same monorepo layout)
 *
 * Returns undefined if no built web client is found.
 */
function resolveWebDistPath(): string | undefined {
  // Try monorepo layout (works for both dev and bundled mode)
  const monorepoPath = resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(monorepoPath)) return monorepoPath;

  // Try npm-published layout (web/dist alongside cli dist)
  const bundledPath = resolve(import.meta.dirname, "../web/dist");
  if (existsSync(bundledPath)) return bundledPath;

  return undefined;
}

async function main() {
  const config = parseCliArgs(process.argv.slice(2));
  const webDistPath = resolveWebDistPath();

  const result = await startCli(config, {
    log: console.log,
    version: VERSION,
    configDir: CONFIG_DIR,
    autoDetect,
    startOrchestrator: async (opts) => {
      const handle = await startServer(opts.port, {
        devMode: true,
        webDistPath: opts.webDistPath ?? webDistPath,
      });
      return {
        port: handle.port,
        shutdown: handle.close,
      };
    },
    startDaemon: async (opts) => {
      return createDaemon(opts);
    },
    discoverOpenCode: async () => {
      return discoverOpenCode();
    },
    attachDaemon: async (opts) => {
      return createAttachDaemon(opts);
    },
  });

  // If the daemon started (or attached), keep the process alive and wire shutdown signals
  if ((result.action === "started" || result.action === "attach") && result.shutdown) {
    const shutdown = async () => {
      console.log("\n[mast] Shutting down...");
      await result.shutdown!();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

/**
 * Create and start the real daemon stack:
 * ProjectConfig → ProjectManager → KeyStore → Relay
 *
 * Returns a shutdown function that tears everything down cleanly.
 */
async function createDaemon(opts: {
  project: DetectedProject;
  port: number;
  orchestratorUrl: string;
  embedded: boolean;
}): Promise<{ shutdown: () => Promise<void> }> {
  const { project, port, orchestratorUrl, embedded } = opts;

  // Use the CLI config directory (same one auto-detect wrote to)
  const projectConfig = new ProjectConfig(CONFIG_DIR);

  let relay: Relay | null = null;

  const projectManager = new ProjectManager(projectConfig, {
    basePort: port,
    skipOpenCode: process.env.MAST_SKIP_OPENCODE === "1",
    onEvent: (_projectName, event) => {
      if (!relay) return;
      const msg: EventMessage = {
        type: "event",
        event: { type: event.type, data: event.data },
        timestamp: new Date().toISOString(),
      };
      relay.send(msg);
    },
    onHealthStateChange: (_projectName, _state, _ready) => {
      if (!relay) return;
      const status: DaemonStatus = {
        type: "status",
        opencodeReady: projectManager.allReady,
      };
      relay.send(status);
    },
    onRecoveryNeeded: async (projectName) => {
      console.log(`[mast] Recovery triggered for "${projectName}" — restarting OpenCode`);
      const managed = projectManager.getProject(projectName);
      if (managed) {
        try {
          await managed.opencode.restart();
        } catch (err) {
          console.error(`[mast] Failed to restart OpenCode for "${projectName}":`, err);
        }
      }
    },
  });

  // Start only the detected project (not all projects from config)
  console.log(`[mast] Starting OpenCode for ${project.name}...`);
  await projectManager.startProject({ name: project.name, directory: project.directory });
  console.log(`[mast] Project "${project.name}" started`);

  // In embedded mode, skip KeyStore — the in-process orchestrator uses HARDCODED_DEVICE_KEY.
  // In external mode, load the paired device key or run pairing flow.
  let deviceKey: string | undefined;
  if (embedded) {
    console.log("[mast] Embedded mode — using default device key");
  } else {
    const keyStore = new KeyStore();
    deviceKey = await keyStore.load();
    if (!deviceKey) {
      console.log("[mast] No device key found — opening browser for pairing");
      deviceKey = await runPairingFlow(orchestratorUrl, {
        projects: [project.name],
        onBrowserOpened: (url) => {
          console.log("[mast] Opening browser for pairing confirmation...");
          console.log(`[mast] If the browser didn't open, visit: ${url}`);
        },
      });
      await keyStore.save(deviceKey);
      console.log("[mast] Device key saved — paired successfully");
    }
  }

  // Connect relay to orchestrator
  relay = new Relay(orchestratorUrl, projectManager, deviceKey);

  try {
    await relay.connect();
    relay.startHealthMonitoring();
    console.log(`[mast] Connected to orchestrator`);
  } catch (err) {
    if (!embedded && err instanceof AuthError) {
      // Device key rejected — clear it and re-pair
      console.warn(`[mast] Device key rejected — clearing and re-pairing`);
      const keyStore = new KeyStore();
      await keyStore.clear();

      const newKey = await runPairingFlow(orchestratorUrl, {
        projects: [project.name],
        onBrowserOpened: (url) => {
          console.log("[mast] Opening browser for pairing confirmation...");
          console.log(`[mast] If the browser didn't open, visit: ${url}`);
        },
      });
      await keyStore.save(newKey);
      console.log("[mast] Device key saved — paired successfully");

      // Reconnect with the fresh key
      relay = new Relay(orchestratorUrl, projectManager, newKey);
      await relay.connect();
      relay.startHealthMonitoring();
      console.log(`[mast] Connected to orchestrator`);
    } else {
      console.warn(`[mast] Could not connect to orchestrator: ${(err as Error).message}`);
      console.warn(`[mast] Running in standalone mode (OpenCode still accessible on port ${port})`);
    }
  }

  return {
    shutdown: async () => {
      if (relay) {
        await relay.disconnect();
      }
      await projectManager.stopAll();
    },
  };
}

/**
 * Create and start the daemon stack in attach mode:
 * ProjectManager.attachProject() → KeyStore → Relay
 *
 * Unlike createDaemon(), this does NOT spawn an OpenCode process.
 * It attaches to an already-running external instance.
 */
async function createAttachDaemon(opts: {
  url: string;
  orchestratorUrl: string;
  embedded: boolean;
}): Promise<{ shutdown: () => Promise<void> }> {
  const { url, orchestratorUrl, embedded } = opts;

  // Derive a project name from the URL (e.g., "opencode-4096")
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const projectName = `opencode-${port}`;

  const projectConfig = new ProjectConfig(CONFIG_DIR);

  let relay: Relay | null = null;

  const projectManager = new ProjectManager(projectConfig, {
    skipOpenCode: true,
    onEvent: (_projectName, event) => {
      if (!relay) return;
      const msg: EventMessage = {
        type: "event",
        event: { type: event.type, data: event.data },
        timestamp: new Date().toISOString(),
      };
      relay.send(msg);
    },
    onHealthStateChange: (_projectName, _state, _ready) => {
      if (!relay) return;
      const status: DaemonStatus = {
        type: "status",
        opencodeReady: projectManager.allReady,
      };
      relay.send(status);
    },
  });

  // Attach (don't spawn) to the external OpenCode instance
  console.log(`[mast] Attaching to external OpenCode at ${url}...`);
  projectManager.attachProject(projectName, url);
  console.log(`[mast] Project "${projectName}" attached`);

  // In embedded mode, skip KeyStore — the in-process orchestrator uses HARDCODED_DEVICE_KEY.
  // In external mode, load the paired device key or run pairing flow.
  let deviceKey: string | undefined;
  if (embedded) {
    console.log("[mast] Embedded mode — using default device key");
  } else {
    const keyStore = new KeyStore();
    deviceKey = await keyStore.load();
    if (!deviceKey) {
      console.log("[mast] No device key found — opening browser for pairing");
      deviceKey = await runPairingFlow(orchestratorUrl, {
        projects: [projectName],
        onBrowserOpened: (url) => {
          console.log("[mast] Opening browser for pairing confirmation...");
          console.log(`[mast] If the browser didn't open, visit: ${url}`);
        },
      });
      await keyStore.save(deviceKey);
      console.log("[mast] Device key saved — paired successfully");
    }
  }

  // Connect relay to orchestrator
  relay = new Relay(orchestratorUrl, projectManager, deviceKey);

  try {
    await relay.connect();
    relay.startHealthMonitoring();
    console.log(`[mast] Connected to orchestrator`);

    // Backfill all existing sessions so the orchestrator has full history
    console.log(`[mast] Backfilling sessions...`);
    await relay.backfillSessions();
    console.log(`[mast] Session backfill complete`);
  } catch (err) {
    if (!embedded && err instanceof AuthError) {
      console.warn(`[mast] Device key rejected — clearing and re-pairing`);
      const keyStore = new KeyStore();
      await keyStore.clear();

      const newKey = await runPairingFlow(orchestratorUrl, {
        projects: [projectName],
        onBrowserOpened: (url) => {
          console.log("[mast] Opening browser for pairing confirmation...");
          console.log(`[mast] If the browser didn't open, visit: ${url}`);
        },
      });
      await keyStore.save(newKey);
      console.log("[mast] Device key saved — paired successfully");

      relay = new Relay(orchestratorUrl, projectManager, newKey);
      await relay.connect();
      relay.startHealthMonitoring();
      console.log(`[mast] Connected to orchestrator`);

      // Backfill after re-pairing too
      console.log(`[mast] Backfilling sessions...`);
      await relay.backfillSessions();
      console.log(`[mast] Session backfill complete`);
    } else {
      console.warn(`[mast] Could not connect to orchestrator: ${(err as Error).message}`);
      console.warn(`[mast] Running in standalone mode`);
    }
  }

  return {
    shutdown: async () => {
      if (relay) {
        await relay.disconnect();
      }
      // detachProject doesn't kill the process, just cleans up SSE/health
      await projectManager.stopAll();
    },
  };
}

main().catch((err) => {
  console.error("[mast] Fatal error:", err);
  process.exit(1);
});
