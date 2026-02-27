/**
 * Detect whether the web client is being served from localhost (local mode).
 *
 * In local mode the orchestrator is running on the same machine, so we can
 * auto-configure the connection without requiring the user to manually enter
 * the server URL or go through the pairing flow.
 */

/** Hard-coded dev token — must match the orchestrator's expected value. */
const DEV_API_TOKEN = "mast-api-token-phase1";

/** Port the orchestrator listens on in dev mode. */
const DEV_ORCHESTRATOR_PORT = 3000;

export type LocalModeResult =
  | { isLocal: true; serverUrl: string; wsUrl: string; apiToken: string }
  | { isLocal: false };

/**
 * Check whether a hostname is a private/LAN IP address.
 * Matches RFC 1918 ranges: 10.x.x.x, 192.168.x.x, 172.16-31.x.x
 */
function isPrivateIp(hostname: string): boolean {
  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/**
 * Inspect an origin string and determine whether it points to a local
 * development environment (localhost or a LAN IP).
 *
 * Pure function (no DOM access) — safe to call under `node:test`.
 */
export function detectLocalMode(origin: string): LocalModeResult {
  try {
    const url = new URL(origin);
    const { hostname, protocol, host } = url;

    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1";
    const isLan = isPrivateIp(hostname);

    if (isLoopback) {
      const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
      return {
        isLocal: true,
        serverUrl: origin,
        wsUrl: `${wsProtocol}//${host}`,
        apiToken: DEV_API_TOKEN,
      };
    }

    if (isLan) {
      // On a LAN IP the UI is served by Vite (port 5173) but API/WS
      // traffic must go directly to the orchestrator (port 3000).
      return {
        isLocal: true,
        serverUrl: `http://${hostname}:${DEV_ORCHESTRATOR_PORT}`,
        wsUrl: `ws://${hostname}:${DEV_ORCHESTRATOR_PORT}`,
        apiToken: DEV_API_TOKEN,
      };
    }

    return { isLocal: false };
  } catch {
    return { isLocal: false };
  }
}
