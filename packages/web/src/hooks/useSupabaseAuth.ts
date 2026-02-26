/**
 * useSupabaseAuth — bridges Supabase Auth into the connection store.
 *
 * On mount:
 * 1. Checks for an existing Supabase session (persisted in localStorage)
 * 2. If found, pushes the access_token into connectionStore.apiToken
 * 3. Sets authReady = true
 *
 * Then subscribes to onAuthStateChange so sign-in, sign-out, and token
 * refresh events keep apiToken in sync.
 *
 * In local mode this hook is effectively a no-op — useAutoConnect
 * overwrites apiToken with the dev token before anything renders.
 *
 * Also sets serverUrl to window.location.origin when a Supabase session
 * exists and we're not in local mode (hosted deployment serves API from
 * the same origin as the web client).
 */

import { useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { useConnectionStore } from "../stores/connection.js";

export function useSupabaseAuth(): void {
  useEffect(() => {
    const { setApiToken, setAuthReady, setServerUrl, serverUrl } =
      useConnectionStore.getState();

    // 1. Check for existing session (persisted by Supabase SDK in localStorage)
    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.error("[useSupabaseAuth] getSession error:", error.message);
        }
        if (session?.access_token) {
          setApiToken(session.access_token);
          // Supabase-authenticated users don't need the daemon pairing step
          useConnectionStore.getState().setPaired(true);
          // In hosted mode, API lives at the same origin that served the page
          if (!serverUrl) {
            const origin = window.location.origin;
            setServerUrl(origin);
          }
        }
        setAuthReady(true);
      })
      .catch((err) => {
        console.error("[useSupabaseAuth] getSession threw:", err);
        setAuthReady(true);
      });

    // 2. Listen for auth state changes (sign-in, sign-out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const store = useConnectionStore.getState();
      if (session?.access_token) {
        store.setApiToken(session.access_token);
        store.setPaired(true);
        if (!store.serverUrl) {
          store.setServerUrl(window.location.origin);
        }
      } else if (event === "SIGNED_OUT") {
        store.setApiToken("");
      }
      // Always ensure authReady is true after any auth event
      if (!store.authReady) {
        store.setAuthReady(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);
}
