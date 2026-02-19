import { OpenCodeProcess } from "./opencode-process.js";
import { Relay } from "./relay.js";

const ORCHESTRATOR_URL =
  process.env.MAST_ORCHESTRATOR_URL ?? "ws://localhost:3000";
const OPENCODE_PORT = parseInt(process.env.OPENCODE_PORT ?? "4096", 10);

async function main() {
  console.log("Mast daemon starting...");

  const opencode = new OpenCodeProcess(OPENCODE_PORT);

  // Start OpenCode (unless skipped)
  if (process.env.MAST_SKIP_OPENCODE !== "1") {
    console.log("Starting opencode serve...");
    await opencode.start();
    console.log("Waiting for OpenCode to be ready...");
    await opencode.waitForReady();
    console.log("OpenCode is ready");
  } else {
    console.log("Skipping opencode start (MAST_SKIP_OPENCODE=1)");
  }

  // Connect to orchestrator
  const relay = new Relay(ORCHESTRATOR_URL, opencode.baseUrl);
  console.log(`Connecting to orchestrator at ${ORCHESTRATOR_URL}...`);
  await relay.connect();

  // Handle shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await relay.disconnect();
    if (process.env.MAST_SKIP_OPENCODE !== "1") {
      await opencode.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
