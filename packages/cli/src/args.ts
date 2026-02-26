/**
 * CLI argument parsing.
 *
 * Uses Node's built-in parseArgs (no external deps).
 * Converts process.argv (minus node + script) into a typed CliConfig.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";

export interface CliConfig {
  command: "start" | "attach" | "help" | "version";
  directory: string;
  port: number;
  orchestratorUrl: string;
  sandbox: boolean;
  attachUrl?: string;
}

const DEFAULT_PORT = 4096;
const DEFAULT_ORCHESTRATOR = "";

export function parseCliArgs(argv: string[]): CliConfig {
  // Check for "attach" subcommand first (before parseArgs, since parseArgs
  // doesn't natively support subcommands)
  if (argv[0] === "attach") {
    const url = argv[1]; // optional — if omitted, will auto-discover
    return {
      command: "attach",
      directory: process.cwd(),
      port: DEFAULT_PORT,
      orchestratorUrl: DEFAULT_ORCHESTRATOR,
      sandbox: false,
      attachUrl: url,
    };
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      port: { type: "string" },
      orchestrator: { type: "string" },
      sandbox: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  // Help / version take precedence
  if (values.help) {
    return {
      command: "help",
      directory: process.cwd(),
      port: DEFAULT_PORT,
      orchestratorUrl: DEFAULT_ORCHESTRATOR,
      sandbox: false,
    };
  }

  if (values.version) {
    return {
      command: "version",
      directory: process.cwd(),
      port: DEFAULT_PORT,
      orchestratorUrl: DEFAULT_ORCHESTRATOR,
      sandbox: false,
    };
  }

  // Parse port
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid port: "${values.port}"`);
    }
  }

  // Resolve directory from positional arg or cwd
  const directory = positionals.length > 0
    ? resolve(positionals[0])
    : process.cwd();

  return {
    command: "start",
    directory,
    port,
    orchestratorUrl: values.orchestrator ?? DEFAULT_ORCHESTRATOR,
    sandbox: values.sandbox ?? false,
  };
}
