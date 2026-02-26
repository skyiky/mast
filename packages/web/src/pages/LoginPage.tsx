/**
 * LoginPage — auth entry point.
 *
 * Two modes:
 * - Hosted (non-localhost): "Sign in with GitHub" via Supabase OAuth.
 *   After redirect, useSupabaseAuth picks up the token automatically.
 * - Dev mode (localhost or manual): URL input + hardcoded dev token.
 */

import { useState } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { supabase } from "../lib/supabase.js";
import "../styles/login.css";

function isLocalOrigin(): boolean {
  try {
    const { hostname } = window.location;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function LoginPage() {
  const local = isLocalOrigin();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDev, setShowDev] = useState(local);
  const [url, setUrl] = useState("http://localhost:3000");
  const setServerUrl = useConnectionStore((s) => s.setServerUrl);
  const setApiToken = useConnectionStore((s) => s.setApiToken);
  const setAuthReady = useConnectionStore((s) => s.setAuthReady);

  // --- GitHub OAuth (hosted mode) ---
  const handleGitHubLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // Always redirect back to the origin after OAuth. If the user was
      // heading to /confirm-daemon?code=..., App.tsx already saved the path
      // in sessionStorage — a redirect handler inside BrowserRouter will
      // pick it up after auth completes.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
      // On success, the browser redirects to GitHub — no further code runs.
      // On return, useSupabaseAuth picks up the token from the URL hash.
    } catch {
      setError("Failed to start sign-in flow");
      setLoading(false);
    }
  };

  // --- Dev mode (manual URL + hardcoded token) ---
  const handleDevConnect = () => {
    if (!url.trim()) return;
    setServerUrl(url.trim().replace(/\/+$/, ""));
    setApiToken("mast-api-token-phase1");
    setAuthReady(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleDevConnect();
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">mast</h1>
        <p className="login-subtitle">Mobile AI Session Terminal</p>

        {!showDev && (
          <>
            <button
              className="login-btn"
              onClick={handleGitHubLogin}
              disabled={loading}
            >
              {loading ? "Redirecting..." : "Sign in with GitHub"}
            </button>

            {error && <p className="login-error">{error}</p>}

            <button
              className="login-link"
              onClick={() => setShowDev(true)}
            >
              Connect manually (dev mode)
            </button>
          </>
        )}

        {showDev && (
          <>
            <label className="login-label" htmlFor="server-url">
              Orchestrator URL
            </label>
            <input
              id="server-url"
              className="login-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="http://localhost:3000"
              autoFocus
            />

            <button
              className="login-btn"
              onClick={handleDevConnect}
              disabled={!url.trim()}
            >
              Connect (Dev Mode)
            </button>

            {!local && (
              <button
                className="login-link"
                onClick={() => setShowDev(false)}
              >
                Sign in with GitHub instead
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
