/**
 * PairPage — gate shown when `paired` is false.
 *
 * In hosted mode (user has apiToken from Supabase), shows a waiting screen
 * with the CLI command to run. The daemon will open the browser to
 * /confirm-daemon automatically — no manual code entry needed.
 *
 * In local mode (no apiToken), shows the legacy manual code entry form.
 */

import { useState, useCallback } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { createApiBinding } from "../hooks/useApi.js";
import { deriveWssUrl } from "../lib/connect-agent.js";
import "../styles/pair.css";

export function PairPage() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
  const signOut = useConnectionStore((s) => s.signOut);

  // Hosted mode: user is authenticated, just waiting for daemon
  if (apiToken) {
    return <HostedWaiting serverUrl={serverUrl} onSignOut={signOut} />;
  }

  // Local mode: manual code entry
  return <ManualPair serverUrl={serverUrl} apiToken={apiToken} />;
}

// ---------------------------------------------------------------------------
// Hosted mode — waiting for daemon to connect
// ---------------------------------------------------------------------------

function HostedWaiting({
  serverUrl,
  onSignOut,
}: {
  serverUrl: string;
  onSignOut: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const wssUrl = deriveWssUrl(serverUrl);
  const cliCommand = `npx mast --orchestrator ${wssUrl}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [cliCommand]);

  return (
    <div className="pair-page">
      <div className="pair-card">
        <div className="pair-icon">{">"}_</div>
        <h2 className="pair-title">Connect your agent</h2>
        <p className="pair-subtitle">
          Run this command in your project directory. Your browser will open
          automatically to confirm the connection.
        </p>

        <div className="pair-command">
          <code className="pair-command-code">{cliCommand}</code>
          <button
            className="pair-command-copy"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <button className="pair-back" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local mode — manual code entry (legacy)
// ---------------------------------------------------------------------------

function ManualPair({
  serverUrl,
  apiToken,
}: {
  serverUrl: string;
  apiToken: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setPaired = useConnectionStore((s) => s.setPaired);
  const signOut = useConnectionStore((s) => s.signOut);

  const handlePair = async () => {
    if (code.length < 4) return;
    setError("");
    setLoading(true);

    try {
      const api = createApiBinding(serverUrl, apiToken);
      const res = await api.pair(code);
      if (res.status === 200 && (res.body as any)?.success) {
        setPaired(true);
      } else {
        setError((res.body as any)?.error ?? "Pairing failed");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handlePair();
  };

  return (
    <div className="pair-page">
      <div className="pair-card">
        <h2 className="pair-title">Pair Device</h2>
        <p className="pair-subtitle">
          Enter the pairing code from your terminal
        </p>

        <input
          className="pair-input"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          onKeyDown={handleKeyDown}
          placeholder="Enter code"
          maxLength={12}
          autoFocus
        />

        {error && <p className="pair-error">{error}</p>}

        <button
          className="pair-btn"
          onClick={handlePair}
          disabled={code.length < 4 || loading}
        >
          {loading ? "Pairing..." : "Pair"}
        </button>

        <button className="pair-back" onClick={signOut}>
          Back to login
        </button>
      </div>
    </div>
  );
}
