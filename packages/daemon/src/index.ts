/**
 * Mast Daemon — Entry point.
 *
 * Startup flow:
 * 1. Create AgentRouter and register adapters based on config:
 *    - OpenCode adapter if MAST_SKIP_OPENCODE !== "1"
 *    - Claude Code adapter if ANTHROPIC_API_KEY is set
 * 2. Start all adapters (launches OpenCode process, loads SDK, etc.)
 * 3. Load device key from ~/.mast/device-key.json
 * 4. If key exists → connect to orchestrator as authenticated daemon
 * 5. If no key → run pairing flow:
 *    a. Connect to orchestrator with token=pairing
 *    b. Generate and display 6-digit pairing code
 *    c. Wait for pair_response with device key
 *    d. Save key, disconnect pairing socket, reconnect as authenticated
 * 6. Connect SemanticRelay to orchestrator
 */

import WebSocket from "ws";
import QRCode from "qrcode";
import { generatePairingCode, type PairRequest, type PairResponse } from "@mast/shared";
import { AgentRouter } from "./agent-router.js";
import { OpenCodeAdapter } from "./adapters/opencode-adapter.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code-adapter.js";
import { SemanticRelay } from "./relay.js";
import { KeyStore } from "./key-store.js";

const ORCHESTRATOR_URL =
  process.env.MAST_ORCHESTRATOR_URL ?? "ws://localhost:3000";
const OPENCODE_PORT = parseInt(process.env.OPENCODE_PORT ?? "4096", 10);

async function main() {
  console.log("Mast daemon starting...");

  // --- Set up AgentRouter and register adapters ---
  const router = new AgentRouter();

  const skipOpenCode = process.env.MAST_SKIP_OPENCODE === "1";
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  if (!skipOpenCode) {
    console.log("[daemon] Registering OpenCode adapter (port=%d)", OPENCODE_PORT);
    const openCodeAdapter = new OpenCodeAdapter({
      port: OPENCODE_PORT,
      onCrash: (code, signal) => {
        console.error(
          `[daemon] OpenCode crashed (code=${code}, signal=${signal}), will auto-restart via health monitor`
        );
      },
    });
    router.registerAdapter(openCodeAdapter);
  } else {
    console.log("[daemon] Skipping OpenCode adapter (MAST_SKIP_OPENCODE=1)");
  }

  if (hasAnthropicKey) {
    console.log("[daemon] Registering Claude Code adapter");
    const claudeAdapter = new ClaudeCodeAdapter();
    router.registerAdapter(claudeAdapter);
  } else {
    console.log("[daemon] Skipping Claude Code adapter (no ANTHROPIC_API_KEY)");
  }

  if (router.getAdapterTypes().length === 0) {
    console.error("[daemon] No adapters registered. Set MAST_SKIP_OPENCODE=0 or provide ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  // --- Start all adapters ---
  console.log("[daemon] Starting adapters...");
  await router.startAll();
  console.log("[daemon] Adapters ready:", router.getAdapterTypes().join(", "));

  // --- Load or acquire device key ---
  const keyStore = new KeyStore();
  let deviceKey = await keyStore.load();

  if (deviceKey) {
    console.log(`[daemon] Loaded device key from ${keyStore.file}`);
  } else {
    console.log("[daemon] No device key found — starting pairing flow");
    deviceKey = await runPairingFlow(ORCHESTRATOR_URL);
    await keyStore.save(deviceKey);
    console.log(`[daemon] Device key saved to ${keyStore.file}`);
  }

  // --- Connect to orchestrator ---
  const relay = new SemanticRelay(ORCHESTRATOR_URL, router, deviceKey);
  console.log(`[daemon] Connecting to orchestrator at ${ORCHESTRATOR_URL}...`);
  await relay.connect();

  // --- Handle shutdown ---
  const shutdown = async () => {
    console.log("[daemon] Shutting down...");
    await relay.disconnect();
    await router.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Pairing flow: connect with token=pairing, send pair_request with
 * a 6-digit code, wait for pair_response containing the device key.
 */
function runPairingFlow(orchestratorUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${orchestratorUrl}/daemon?token=pairing`;
    const ws = new WebSocket(wsUrl);
    const code = generatePairingCode();

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Pairing timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    ws.on("open", () => {
      // Send pairing request
      const request: PairRequest = {
        type: "pair_request",
        pairingCode: code,
      };
      ws.send(JSON.stringify(request));

      // Build QR payload — the mobile app scans this to auto-pair
      const httpUrl = orchestratorUrl.replace(/^ws/, "http");
      const qrPayload = JSON.stringify({ url: httpUrl, code });

      console.log("");
      console.log("=========================================");
      console.log(`  PAIRING CODE:  ${code}`);
      console.log("  Enter this code on your phone to pair.");
      console.log("=========================================");

      // Display QR code in terminal (async, non-blocking)
      QRCode.toString(qrPayload, { type: "terminal", small: true })
        .then((qrString: string) => {
          console.log("");
          console.log("  Or scan this QR code with the Mast app:");
          console.log("");
          console.log(qrString);
        })
        .catch(() => {
          // QR code display is optional — code entry still works
          console.log("  (QR code display unavailable)");
        });

      console.log("");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as PairResponse;
        if (msg.type === "pair_response") {
          clearTimeout(timeout);
          if (msg.success && msg.deviceKey) {
            console.log("[daemon] Pairing successful!");
            ws.close();
            resolve(msg.deviceKey);
          } else {
            ws.close();
            reject(new Error(`Pairing failed: ${msg.error ?? "unknown error"}`));
          }
        }
      } catch (err) {
        console.error("[daemon] Error parsing pairing message:", err);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Pairing connection failed: ${err.message}`));
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      // If we get here without resolving, the connection was dropped
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
