/**
 * Pairing flow — shared between daemon and CLI.
 *
 * Connects to the orchestrator with `token=pairing`, sends a pair_request
 * containing a 6-digit code, and waits for the pair_response with a device key.
 */

import WebSocket from "ws";
import {
  generatePairingCode,
  type PairRequest,
  type PairResponse,
} from "@mast/shared";

export interface PairingFlowOptions {
  /** Called when the pairing code is ready to be displayed. */
  onDisplayCode?: (code: string, qrPayload: string) => void;
  /** Timeout in ms (default: 5 minutes). */
  timeoutMs?: number;
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
  const { onDisplayCode, timeoutMs = 5 * 60 * 1000 } = options ?? {};

  return new Promise((resolve, reject) => {
    const wsUrl = `${orchestratorUrl}/daemon?token=pairing`;
    const ws = new WebSocket(wsUrl);
    const code = generatePairingCode();

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Pairing timed out after 5 minutes"));
    }, timeoutMs);

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

      if (onDisplayCode) {
        onDisplayCode(code, qrPayload);
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
