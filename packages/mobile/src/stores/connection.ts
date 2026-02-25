import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ConnectionState {
  /** Orchestrator base URL (HTTP) */
  serverUrl: string;
  /** Orchestrator WebSocket URL */
  wsUrl: string;
  /** Supabase access_token — used as Bearer token for all API/WSS calls */
  apiToken: string;
  /** Whether auth state has been resolved (Supabase session checked) */
  authReady: boolean;
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
  setAuthReady: (ready: boolean) => void;
  setWsConnected: (connected: boolean) => void;
  setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) => void;
  setPaired: (paired: boolean) => void;
  /** Reset connection state (sign out). Does NOT clear Supabase session —
   *  call supabase.auth.signOut() separately. */
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

      reset: () => {
        set({ ...DEFAULT_STATE, authReady: true });
      },
    }),
    {
      name: "mast-connection",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist connection config, not ephemeral auth/connection state.
      // apiToken comes from Supabase session (managed by Supabase SDK).
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        wsUrl: state.wsUrl,
        paired: state.paired,
      }),
    },
  ),
);
