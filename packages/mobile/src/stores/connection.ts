import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ConnectionState {
  /** Orchestrator base URL (HTTP) */
  serverUrl: string;
  /** Orchestrator WebSocket URL */
  wsUrl: string;
  /** API token for phone auth */
  apiToken: string;
  /** Whether the phone WebSocket is connected to orchestrator */
  wsConnected: boolean;
  /** Whether the daemon is connected to orchestrator */
  daemonConnected: boolean;
  /** Whether OpenCode is healthy on the daemon machine */
  opencodeReady: boolean;
  /** Whether initial setup (pairing) is complete */
  paired: boolean;

  // Actions
  setServerUrl: (url: string) => void;
  setApiToken: (token: string) => void;
  setWsConnected: (connected: boolean) => void;
  setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) => void;
  setPaired: (paired: boolean) => void;
  reset: () => void;
}

const DEFAULT_STATE = {
  serverUrl: "",
  wsUrl: "",
  apiToken: "mast-api-token-phase1", // hardcoded for Phase 5
  wsConnected: false,
  daemonConnected: false,
  opencodeReady: false,
  paired: false,
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

      setWsConnected: (connected: boolean) => set({ wsConnected: connected }),

      setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) =>
        set({ daemonConnected, opencodeReady }),

      setPaired: (paired: boolean) => set({ paired }),

      reset: () => set(DEFAULT_STATE),
    }),
    {
      name: "mast-connection",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        wsUrl: state.wsUrl,
        apiToken: state.apiToken,
        paired: state.paired,
      }),
    },
  ),
);
