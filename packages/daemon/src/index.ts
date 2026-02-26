/**
 * Mast Daemon — Entry point.
 *
 * Multi-project startup flow:
 * 1. Load project config from ~/.mast/projects.json
 * 2. Create ProjectManager and start all OpenCode instances
 * 3. Load device key from ~/.mast/device-key.json
 * 4. If key exists → connect to orchestrator as authenticated daemon
 * 5. If no key → run pairing flow (opens browser for user confirmation)
 * 6. Start health monitoring for all projects
 */

import {
  type EventMessage,
  type DaemonStatus,
} from "@mast/shared";
import { Relay, AuthError } from "./relay.js";
import { KeyStore } from "./key-store.js";
import { ProjectConfig } from "./project-config.js";
import { ProjectManager } from "./project-manager.js";
import { runPairingFlow } from "./pairing-flow.js";

const ORCHESTRATOR_URL =
  process.env.MAST_ORCHESTRATOR_URL ?? "ws://localhost:3000";
const OPENCODE_PORT = parseInt(process.env.OPENCODE_PORT ?? "4096", 10);

// Make the daemon identifiable in process lists (instead of generic "node.exe")
process.title = "mast-daemon";

async function main() {
  console.log("Mast daemon starting...");

  const skipOpenCode = process.env.MAST_SKIP_OPENCODE === "1";

  // --- Load project config ---
  const projectConfig = new ProjectConfig();
  const projects = await projectConfig.load();

  if (projects.length === 0) {
    console.warn(
      "[daemon] No projects configured in ~/.mast/projects.json",
    );
    console.warn(
      "[daemon] Add a project: POST /project with { name, directory }",
    );
    console.warn(
      "[daemon] Or create ~/.mast/projects.json manually:",
    );
    console.warn(
      '  { "projects": [{ "name": "my-app", "directory": "/path/to/repo" }] }',
    );
  } else {
    console.log(
      `[daemon] Found ${projects.length} project(s): ${projects.map((p) => p.name).join(", ")}`,
    );
  }

  // --- Create ProjectManager and start all instances ---
  let relay: Relay | null = null;

  const projectManager = new ProjectManager(projectConfig, {
    basePort: OPENCODE_PORT,
    skipOpenCode,
    // Wire SSE events → relay → orchestrator
    onEvent: (_projectName, event) => {
      if (!relay) return;
      const msg: EventMessage = {
        type: "event",
        event: {
          type: event.type,
          data: event.data,
        },
        timestamp: new Date().toISOString(),
      };
      relay.send(msg);
    },
    // Wire health state changes → relay → orchestrator
    onHealthStateChange: (_projectName, _state, ready) => {
      if (!relay) return;
      // Report overall readiness: true only if ALL projects are ready
      const status: DaemonStatus = {
        type: "status",
        opencodeReady: projectManager.allReady,
      };
      relay.send(status);
    },
    // Wire recovery → restart the project's OpenCode process
    onRecoveryNeeded: async (projectName) => {
      console.log(
        `[daemon] Health monitor triggered recovery for "${projectName}" — restarting OpenCode`,
      );
      const managed = projectManager.getProject(projectName);
      if (managed) {
        try {
          await managed.opencode.restart();
        } catch (err) {
          console.error(
            `[daemon] Failed to restart OpenCode for "${projectName}":`,
            err,
          );
        }
      }
    },
  });

  if (projects.length > 0) {
    console.log("[daemon] Starting OpenCode instances...");
    const started = await projectManager.startAll();
    console.log(
      `[daemon] ${started.length}/${projects.length} project(s) started`,
    );
  }

  // Collect project names for pairing metadata
  const projectNames = projects.map((p) => p.name);

  // --- Load or acquire device key ---
  const keyStore = new KeyStore();
  let deviceKey = await keyStore.load();

  if (deviceKey) {
    console.log(`[daemon] Loaded device key from ${keyStore.file}`);
  } else {
    console.log("[daemon] No device key found — opening browser for pairing");
    deviceKey = await runPairingFlow(ORCHESTRATOR_URL, {
      projects: projectNames,
      onBrowserOpened: (url) => {
        console.log("[daemon] Opening browser for pairing confirmation...");
        console.log(`[daemon] If the browser didn't open, visit: ${url}`);
      },
    });
    await keyStore.save(deviceKey);
    console.log(`[daemon] Device key saved to ${keyStore.file}`);
  }

  // --- Connect to orchestrator ---
  relay = new Relay(ORCHESTRATOR_URL, projectManager, deviceKey);
  console.log(`[daemon] Connecting to orchestrator at ${ORCHESTRATOR_URL}...`);

  try {
    await relay.connect();
  } catch (err) {
    if (err instanceof AuthError) {
      // Device key was rejected — delete it and re-pair
      console.warn(
        `[daemon] Device key rejected (${err.statusCode}) — clearing key and re-pairing`,
      );
      await keyStore.clear();

      const newKey = await runPairingFlow(ORCHESTRATOR_URL, {
        projects: projectNames,
        onBrowserOpened: (url) => {
          console.log("[daemon] Opening browser for pairing confirmation...");
          console.log(`[daemon] If the browser didn't open, visit: ${url}`);
        },
      });
      await keyStore.save(newKey);
      console.log(`[daemon] New device key saved to ${keyStore.file}`);

      // Reconnect with the fresh key
      relay = new Relay(ORCHESTRATOR_URL, projectManager, newKey);
      await relay.connect();
    } else {
      throw err;
    }
  }

  // --- Start health monitoring for all projects ---
  relay.startHealthMonitoring();

  // --- Handle shutdown ---
  const shutdown = async () => {
    console.log("[daemon] Shutting down...");
    if (relay) {
      await relay.disconnect();
    }
    await projectManager.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
