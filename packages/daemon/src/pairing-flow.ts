/**
 * Pairing flow — shared between daemon and CLI.
 *
 * Connects to the orchestrator with `token=pairing`, sends a pair_request
 * containing a 6-digit code (plus hostname and projects metadata), and waits
 * for the pair_response with a device key.
 *
 * The browser-confirmation approach: instead of displaying a code in the
 * terminal for the user to type, we open the user's browser to
 * `/confirm-daemon?code=<code>` on the orchestrator. The user clicks "Approve"
 * in the browser, which calls POST /pair/verify, and the orchestrator sends
 * the device key back over the WebSocket.
 */

import { hostname as osHostname } from "node:os";
import { exec } from "node:child_process";
import WebSocket from "ws";
import {
  generatePairingCode,
  type PairRequest,
  type PairResponse,
} from "@mast/shared";

export interface PairingFlowOptions {
  /** Machine hostname (defaults to os.hostname()). */
  hostname?: string;
  /** Project names the daemon is managing. */
  projects?: string[];
  /** Called after the browser is opened (for logging). */
  onBrowserOpened?: (confirmUrl: string) => void;
  /** Timeout in ms (default: 5 minutes). */
  timeoutMs?: number;
}

/**
 * Open a URL in the user's default browser.
 * Uses platform-appropriate commands: start (Windows), open (macOS), xdg-open (Linux).
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === "win32") {
    // `start` needs an empty title string when the URL contains special chars
    cmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      // Non-fatal — the fallback URL is printed to the terminal
    }
  });
}

/**
 * Derive the HTTP(S) base URL of the orchestrator's web UI from its WebSocket URL.
 *
 * The orchestrator may be accessed via different front-end URLs (e.g. on Render
 * the WSS URL is `wss://mast-orch.onrender.com` but the web UI may be at a
 * different origin). For now we simply convert ws→http / wss→https. If a
 * `MAST_WEB_URL` env variable is set, we use that instead.
 */
function deriveWebUrl(orchestratorUrl: string): string {
  const override = process.env.MAST_WEB_URL;
  if (override) return override.replace(/\/+$/, "");
  return orchestratorUrl.replace(/^ws/, "http").replace(/\/+$/, "");
}

/**
 * Run the pairing flow against an orchestrator.
 *
 * @param orchestratorUrl  WebSocket base URL (e.g. `ws://localhost:3000` or `wss://host.com`)
 * @param options          Optional callbacks and config
 * @returns  The device key issued by the orchestrator
 */
export function runPairingFlow(
  orchestratorUrl: string,
  options?: PairingFlowOptions,
): Promise<string> {
  const {
    hostname = osHostname(),
    projects = [],
    onBrowserOpened,
    timeoutMs = 5 * 60 * 1000,
  } = options ?? {};

  return new Promise((resolve, reject) => {
    const wsUrl = `${orchestratorUrl}/daemon?token=pairing`;
    const ws = new WebSocket(wsUrl);
    const code = generatePairingCode();

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Pairing timed out after 5 minutes"));
    }, timeoutMs);

    ws.on("open", () => {
      // Send pairing request with metadata
      const request: PairRequest = {
        type: "pair_request",
        pairingCode: code,
        hostname,
        projects,
      };
      ws.send(JSON.stringify(request));

      // Open the user's browser to the confirmation page
      const webBase = deriveWebUrl(orchestratorUrl);
      const confirmUrl = `${webBase}/confirm-daemon?code=${encodeURIComponent(code)}`;
      openBrowser(confirmUrl);

      if (onBrowserOpened) {
        onBrowserOpened(confirmUrl);
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as PairResponse;
        if (msg.type === "pair_response") {
          clearTimeout(timeout);
          if (msg.success && msg.deviceKey) {
            ws.close();
            resolve(msg.deviceKey);
          } else {
            ws.close();
            reject(
              new Error(`Pairing failed: ${msg.error ?? "unknown error"}`),
            );
          }
        }
      } catch (err) {
        // Ignore parse errors — wait for a valid pair_response
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
