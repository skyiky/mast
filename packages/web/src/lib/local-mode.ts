/**
 * Detect whether the web client is being served from localhost (local mode).
 *
 * In local mode the orchestrator is running on the same machine, so we can
 * auto-configure the connection without requiring the user to manually enter
 * the server URL or go through the pairing flow.
 */

/** Hard-coded dev token — must match the orchestrator's expected value. */
const DEV_API_TOKEN = "mast-api-token-phase1";

export type LocalModeResult =
  | { isLocal: true; serverUrl: string; wsUrl: string; apiToken: string }
  | { isLocal: false };

/**
 * Inspect an origin string and determine whether it points to localhost.
 *
 * Pure function (no DOM access) — safe to call under `node:test`.
 */
export function detectLocalMode(origin: string): LocalModeResult {
  try {
    const url = new URL(origin);
    const { hostname, protocol, host } = url;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
      return {
        isLocal: true,
        serverUrl: origin,
        wsUrl: `${wsProtocol}//${host}`,
        apiToken: DEV_API_TOKEN,
      };
    }

    return { isLocal: false };
  } catch {
    return { isLocal: false };
  }
}
