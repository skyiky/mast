/**
 * ConnectAgentPanel — shown in hosted mode when no daemon is connected.
 *
 * Displays:
 * 1. The CLI command to run (`npx mast --orchestrator <wss-url>`)
 * 2. A pairing code input (6-digit code from the terminal)
 */

import { useState, useCallback } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { createApiBinding } from "../hooks/useApi.js";
import { deriveWssUrl } from "../lib/connect-agent.js";
import "../styles/connect-agent.css";

export function ConnectAgentPanel() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
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

  const handleVerify = useCallback(async () => {
    if (code.length < 4) return;
    setError("");
    setLoading(true);

    try {
      const api = createApiBinding(serverUrl, apiToken);
      const res = await api.pair(code);
      if (res.status === 200 && (res.body as any)?.success) {
        setSuccess(true);
        setCode("");
      } else {
        setError((res.body as any)?.error ?? "Invalid code");
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }, [code, serverUrl, apiToken]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleVerify();
    },
    [handleVerify],
  );

  return (
    <div className="connect-agent">
      <div className="connect-agent-icon">{">"}_</div>
      <h3 className="connect-agent-title">Connect your agent</h3>
      <p className="connect-agent-subtitle">
        Run this command in your project directory to connect an AI coding agent
      </p>

      <div className="connect-agent-command">
        <code className="connect-agent-code">{cliCommand}</code>
        <button
          className="connect-agent-copy"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="connect-agent-divider">
        <span>then enter the pairing code</span>
      </div>

      <div className="connect-agent-pair">
        <input
          className="connect-agent-input"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={handleKeyDown}
          placeholder="000000"
          maxLength={6}
        />
        <button
          className="connect-agent-verify"
          onClick={handleVerify}
          disabled={code.length < 6 || loading}
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
      </div>

      {error && <p className="connect-agent-error">{error}</p>}
      {success && <p className="connect-agent-success">Agent connected!</p>}
    </div>
  );
}
