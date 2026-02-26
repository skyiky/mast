/**
 * CLI runner — orchestrates the full startup flow.
 *
 * Designed for testability: all side-effectful operations are injected
 * via CliDeps, so tests can use fakes.
 */

import type { CliConfig } from "./args.js";
import type { DetectedProject } from "./auto-detect.js";

/**
 * Deps interface for testability — inject fakes in tests,
 * real implementations in production.
 */
export interface CliDeps {
  /** Print a line to stdout */
  log: (msg: string) => void;
  /** Auto-detect project from directory */
  autoDetect: (opts: { directory: string; configDir: string }) => Promise<DetectedProject>;
  /** Start the daemon (ProjectManager + Relay) — returns a shutdown function */
  startDaemon: (opts: {
    project: DetectedProject;
    port: number;
    orchestratorUrl: string;
    /** True when orchestrator is embedded (skip KeyStore, use hardcoded key) */
    embedded: boolean;
  }) => Promise<{ shutdown: () => Promise<void> }>;
  /** Start the embedded orchestrator — returns port and shutdown */
  startOrchestrator: (opts: {
    port: number;
    webDistPath?: string;
  }) => Promise<{ port: number; shutdown: () => Promise<void> }>;
  /** Get the config directory (default ~/.mast) */
  configDir: string;
  /** Package version for --version output */
  version: string;
}

export interface CliResult {
  /** What the CLI decided to do */
  action: "started" | "help" | "version" | "attach";
  /** Project that was started (if action is "started") */
  project?: DetectedProject;
  /** Shutdown function (if daemon was started) */
  shutdown?: () => Promise<void>;
}

const HELP_TEXT = `
Usage: mast [directory] [options]

Commands:
  mast                        Start daemon for current directory
  mast /path/to/project       Start daemon for specific project
  mast attach <url>           Attach to running OpenCode instance

Options:
  --port <number>             OpenCode port (default: 4096)
  --orchestrator <url>        Connect to external orchestrator (default: embedded)
  --sandbox                   Enable sandbox mode
  -h, --help                  Show this help text
  -v, --version               Show version
`.trim();

export async function startCli(
  config: CliConfig,
  deps: CliDeps,
): Promise<CliResult> {
  // --- Help ---
  if (config.command === "help") {
    deps.log(HELP_TEXT);
    return { action: "help" };
  }

  // --- Version ---
  if (config.command === "version") {
    deps.log(`mast v${deps.version}`);
    return { action: "version" };
  }

  // --- Attach (placeholder for Feature 3) ---
  if (config.command === "attach") {
    deps.log(`Attaching to ${config.attachUrl}...`);
    return { action: "attach" };
  }

  // --- Start (main flow) ---
  // 1. Auto-detect project
  const project = await deps.autoDetect({
    directory: config.directory,
    configDir: deps.configDir,
  });

  if (project.isNew) {
    deps.log(`[mast] Registered new project: ${project.name} → ${project.directory}`);
  } else {
    deps.log(`[mast] Found existing project: ${project.name}`);
  }

  // 2. Start embedded orchestrator (if no external URL provided)
  let orchestratorUrl = config.orchestratorUrl;
  let orchestratorShutdown: (() => Promise<void>) | undefined;
  const embedded = !orchestratorUrl;

  if (!orchestratorUrl) {
    // Embedded mode — start orchestrator in-process
    deps.log("[mast] Starting orchestrator...");
    const orchestrator = await deps.startOrchestrator({ port: 3000 });
    orchestratorUrl = `ws://localhost:${orchestrator.port}`;
    orchestratorShutdown = orchestrator.shutdown;
    deps.log(`[mast] Web UI: http://localhost:${orchestrator.port}`);
  }

  // 3. Start daemon
  deps.log(`[mast] Starting ${project.name} on port ${config.port}...`);
  const daemon = await deps.startDaemon({
    project,
    port: config.port,
    orchestratorUrl,
    embedded,
  });

  deps.log(`[mast] ${project.name} is running`);
  deps.log(`[mast] Orchestrator: ${orchestratorUrl}`);

  return {
    action: "started",
    project,
    shutdown: async () => {
      await daemon.shutdown();
      if (orchestratorShutdown) await orchestratorShutdown();
    },
  };
}
