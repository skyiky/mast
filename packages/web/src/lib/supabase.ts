/**
 * Supabase client — singleton for browser auth.
 *
 * Uses localStorage for session persistence (Supabase SDK default for browser).
 * Auto-refresh keeps the access_token fresh without AppState listeners
 * (the browser handles visibility natively).
 *
 * detectSessionInUrl: true — after GitHub OAuth redirect, the SDK
 * automatically parses tokens from the URL hash fragment.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ivfpwrpywnkhnbdcgccx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2ZnB3cnB5d25raG5iZGNnY2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDk5NTIsImV4cCI6MjA4NzEyNTk1Mn0.hPZE2q02F0zS98d5yNdNUdGp1zWjbewcIhLOE4TkFl4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Use implicit grant flow — tokens arrive directly in the URL hash
    // fragment (#access_token=...) rather than requiring a PKCE code exchange.
    // PKCE (the v2 default) requires an extra server round-trip that can fail
    // silently in hosted environments.
    flowType: "implicit",
  },
});
