#!/usr/bin/env node

/**
 * CLI entry point — wires real dependencies into startCli().
 *
 * This is the production entry point for `npx mast`.
 * All side-effectful operations (fs, spawn, network) are resolved here
 * and injected into the runner, keeping the runner itself testable.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { parseCliArgs } from "./args.js";
import { autoDetect } from "./auto-detect.js";
import { startCli } from "./runner.js";
import { startServer } from "@mast/orchestrator/server";
import { ProjectConfig } from "@mast/daemon/project-config";
import { ProjectManager } from "@mast/daemon/project-manager";
import { Relay } from "@mast/daemon/relay";
import { KeyStore } from "@mast/daemon/key-store";
import type { DaemonStatus, EventMessage } from "@mast/shared";
import type { DetectedProject } from "./auto-detect.js";

// Make the CLI process identifiable
process.title = "mast-cli";

const VERSION = "0.0.1";
const CONFIG_DIR = join(homedir(), ".mast");

async function main() {
  const config = parseCliArgs(process.argv.slice(2));

  const result = await startCli(config, {
    log: console.log,
    version: VERSION,
    configDir: CONFIG_DIR,
    autoDetect,
    startOrchestrator: async (opts) => {
      const handle = await startServer(opts.port, {
        devMode: true,
        webDistPath: opts.webDistPath,
      });
      return {
        port: handle.port,
        shutdown: handle.close,
      };
    },
    startDaemon: async (opts) => {
      return createDaemon(opts);
    },
  });

  // If the daemon started, keep the process alive and wire shutdown signals
  if (result.action === "started" && result.shutdown) {
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
}): Promise<{ shutdown: () => Promise<void> }> {
  const { project, port, orchestratorUrl } = opts;

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

  // Start the single project
  console.log(`[mast] Starting OpenCode for ${project.name}...`);
  const started = await projectManager.startAll();
  console.log(`[mast] ${started.length} project(s) started`);

  // Load or skip device key (pairing requires the full daemon flow;
  // the CLI in MVP mode can use the hardcoded key or skip orchestrator)
  const keyStore = new KeyStore();
  let deviceKey = await keyStore.load();

  if (!deviceKey) {
    console.log("[mast] No device key found — using default key (pair via daemon for production)");
  }

  // Connect relay to orchestrator
  relay = new Relay(orchestratorUrl, projectManager, deviceKey ?? undefined);

  try {
    await relay.connect();
    relay.startHealthMonitoring();
    console.log(`[mast] Connected to orchestrator`);
  } catch (err) {
    console.warn(`[mast] Could not connect to orchestrator: ${(err as Error).message}`);
    console.warn(`[mast] Running in standalone mode (OpenCode still accessible on port ${port})`);
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

main().catch((err) => {
  console.error("[mast] Fatal error:", err);
  process.exit(1);
});
