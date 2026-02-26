import { useEffect, useRef } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { detectLocalMode } from "../lib/local-mode.js";

/**
 * Try to auto-connect synchronously. Called once during module load
 * (after Zustand persist hydrates from localStorage, which is synchronous).
 *
 * This runs before the first React render, so the App component sees
 * the auto-connected state immediately — no flash of LoginPage.
 */
function tryAutoConnect(): void {
  if (!useConnectionStore.persist.hasHydrated()) return;

  const { apiToken } = useConnectionStore.getState();
  if (apiToken) return;

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const result = detectLocalMode(origin);
  if (!result.isLocal) return;

  useConnectionStore.setState({
    serverUrl: result.serverUrl,
    wsUrl: result.wsUrl,
    apiToken: result.apiToken,
    authReady: true,
    paired: true,
  });
}

// Run immediately — Zustand persist with localStorage hydrates synchronously,
// so this executes before the first React render.
tryAutoConnect();

/**
 * Hook that re-runs auto-connect after hydration (safety net for async storage).
 * In the common case (localStorage = sync), the module-level call above already
 * handled it and this is a no-op.
 */
export function useAutoConnect(hydrated: boolean): void {
  const ran = useRef(false);

  useEffect(() => {
    if (!hydrated || ran.current) return;
    ran.current = true;

    const { apiToken } = useConnectionStore.getState();
    if (apiToken) return;

    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const result = detectLocalMode(origin);
    if (!result.isLocal) return;

    useConnectionStore.setState({
      serverUrl: result.serverUrl,
      wsUrl: result.wsUrl,
      apiToken: result.apiToken,
      authReady: true,
      paired: true,
    });
  }, [hydrated]);
}
