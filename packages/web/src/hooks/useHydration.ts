import { useState, useEffect } from "react";
import { useConnectionStore } from "../stores/connection.js";

/**
 * Track Zustand persist hydration status using the official v5 API.
 *
 * Uses `persist.hasHydrated()` for the initial check and
 * `persist.onFinishHydration()` to subscribe to future hydration events.
 *
 * This avoids the circular-reference problem of calling
 * `useConnectionStore.setState()` inside `onRehydrateStorage` during
 * store initialization.
 */
export function useHydration(): boolean {
  const [hydrated, setHydrated] = useState(
    useConnectionStore.persist.hasHydrated(),
  );

  useEffect(() => {
    const unsub = useConnectionStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    // In case hydration finished between the initial useState and this effect:
    setHydrated(useConnectionStore.persist.hasHydrated());
    return unsub;
  }, []);

  return hydrated;
}
