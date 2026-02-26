import { create } from "zustand";
import { persist } from "zustand/middleware";
import { detectLocalMode } from "../lib/local-mode.js";

interface ConnectionState {
  /** Orchestrator base URL (HTTP) */
  serverUrl: string;
  /** Orchestrator WebSocket URL */
  wsUrl: string;
  /** Auth token — used as Bearer token for all API/WSS calls */
  apiToken: string;
  /** Whether auth state has been resolved */
  authReady: boolean;
  /** Whether the browser WebSocket is connected to orchestrator */
  wsConnected: boolean;
  /** Whether the daemon is connected to orchestrator */
  daemonConnected: boolean;
  /** Whether OpenCode is healthy on the daemon machine */
  opencodeReady: boolean;
  /** Whether initial setup (pairing) is complete */
  paired: boolean;
  /** Whether persist rehydration is complete */
  _hydrated: boolean;

  // Actions
  setServerUrl: (url: string) => void;
  setApiToken: (token: string) => void;
  setAuthReady: (ready: boolean) => void;
  setWsConnected: (connected: boolean) => void;
  setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) => void;
  setPaired: (paired: boolean) => void;
  /** Sign out — clears auth + ephemeral state but preserves pairing/server config. */
  signOut: () => void;
  /** Full reset — clears ALL state including pairing. Used by "re-pair device". */
  reset: () => void;
}

const DEFAULT_STATE = {
  serverUrl: "",
  wsUrl: "",
  apiToken: "",
  authReady: false,
  wsConnected: false,
  daemonConnected: false,
  opencodeReady: false,
  paired: false,
  _hydrated: false,
};

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setServerUrl: (url: string) => {
        // Derive wsUrl from httpUrl
        const wsUrl = url.replace(/^http/, "ws");
        set({ serverUrl: url, wsUrl });
      },

      setApiToken: (token: string) => set({ apiToken: token }),

      setAuthReady: (ready: boolean) => set({ authReady: ready }),

      setWsConnected: (connected: boolean) => set({ wsConnected: connected }),

      setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) =>
        set({ daemonConnected, opencodeReady }),

      setPaired: (paired: boolean) => set({ paired }),

      signOut: () => {
        set({
          apiToken: "",
          wsConnected: false,
          daemonConnected: false,
          opencodeReady: false,
        });
      },

      reset: () => {
        set({ ...DEFAULT_STATE, authReady: true });
      },
    }),
    {
      name: "mast-connection",
      // Zustand v5 defaults to localStorage — no storage option needed.
      // Only persist connection config, not ephemeral auth/connection state.
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        wsUrl: state.wsUrl,
        paired: state.paired,
      }),
      onRehydrateStorage: () => {
        // Returned function runs AFTER rehydration completes.
        return (state, error) => {
          // Mark hydration complete regardless of whether state was found.
          // Without this, the App renders null forever.
          useConnectionStore.setState({ _hydrated: true });

          if (error) return;

          // Auto-connect in local mode: if no apiToken after rehydration
          // and we're on localhost, configure the connection automatically.
          const currentToken = useConnectionStore.getState().apiToken;
          if (!currentToken) {
            const origin =
              typeof window !== "undefined"
                ? window.location.origin
                : "";
            const result = detectLocalMode(origin);
            if (result.isLocal) {
              useConnectionStore.setState({
                serverUrl: result.serverUrl,
                wsUrl: result.wsUrl,
                apiToken: result.apiToken,
                authReady: true,
                paired: true,
              });
            }
          }
        };
      },
    },
  ),
);
