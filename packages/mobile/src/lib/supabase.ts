/**
 * Supabase client — singleton for auth and (future) data access.
 *
 * Uses AsyncStorage for session persistence so the user stays logged in
 * across app restarts. Auto-refresh keeps the access_token fresh.
 *
 * The AppState listener starts/stops the auto-refresh timer when the
 * app goes foreground/background — no wasted refresh calls while the
 * app is in the pocket.
 */

import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

const SUPABASE_URL = "https://ivfpwrpywnkhnbdcgccx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2ZnB3cnB5d25raG5iZGNnY2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDk5NTIsImV4cCI6MjA4NzEyNTk1Mn0.hPZE2q02F0zS98d5yNdNUdGp1zWjbewcIhLOE4TkFl4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Expo doesn't use window.location — don't try to detect session from URL
    detectSessionInUrl: false,
  },
});

/**
 * Start/stop Supabase auto-refresh based on AppState.
 * Call once at app startup (e.g., in _layout.tsx useEffect).
 */
export function setupAuthRefreshListener(): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });

  // Start immediately since the app is active when this runs
  supabase.auth.startAutoRefresh();

  return () => {
    supabase.auth.stopAutoRefresh();
    subscription.remove();
  };
}
