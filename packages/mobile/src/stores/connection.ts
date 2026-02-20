import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getSecureApiToken,
  setSecureApiToken,
  deleteSecureApiToken,
} from "../lib/secure-token";

interface ConnectionState {
  /** Orchestrator base URL (HTTP) */
  serverUrl: string;
  /** Orchestrator WebSocket URL */
  wsUrl: string;
  /** API token for phone auth — loaded from SecureStore on startup */
  apiToken: string;
  /** Whether the token has been loaded from SecureStore */
  tokenLoaded: boolean;
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
  /** Load API token from SecureStore — call once on app startup */
  loadToken: () => Promise<void>;
}

const DEFAULT_API_TOKEN = "mast-api-token-phase1";

const DEFAULT_STATE = {
  serverUrl: "",
  wsUrl: "",
  apiToken: DEFAULT_API_TOKEN,
  tokenLoaded: false,
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

      setApiToken: (token: string) => {
        // Persist to SecureStore (fire-and-forget)
        setSecureApiToken(token);
        set({ apiToken: token });
      },

      setWsConnected: (connected: boolean) => set({ wsConnected: connected }),

      setDaemonStatus: (daemonConnected: boolean, opencodeReady: boolean) =>
        set({ daemonConnected, opencodeReady }),

      setPaired: (paired: boolean) => set({ paired }),

      reset: () => {
        deleteSecureApiToken();
        set({ ...DEFAULT_STATE, apiToken: DEFAULT_API_TOKEN, tokenLoaded: true });
      },

      loadToken: async () => {
        const token = await getSecureApiToken();
        if (token) {
          set({ apiToken: token, tokenLoaded: true });
        } else {
          // First launch — persist the default token to SecureStore
          await setSecureApiToken(DEFAULT_API_TOKEN);
          set({ tokenLoaded: true });
        }
      },
    }),
    {
      name: "mast-connection",
      storage: createJSONStorage(() => AsyncStorage),
      // apiToken is NO LONGER persisted in AsyncStorage — it lives in SecureStore
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        wsUrl: state.wsUrl,
        paired: state.paired,
      }),
    },
  ),
);
