/**
 * Utilities for the "Connect Agent" panel in hosted mode.
 */

/**
 * Derive a WSS URL from an HTTP(S) server URL.
 * Used to build the `npx mast --orchestrator <wss-url>` command.
 */
export function deriveWssUrl(serverUrl: string): string {
  if (!serverUrl) return "";
  const wss = serverUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return wss.replace(/\/+$/, "");
}
