/**
 * ConnectAgentPanel — shown in hosted mode when no daemon is connected.
 *
 * Displays the CLI command to run (`npx mast --orchestrator <wss-url>`).
 * Pairing is handled automatically: the daemon opens the browser to the
 * confirmation page — no manual code entry needed.
 */

import { useState, useCallback } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { deriveWssUrl } from "../lib/connect-agent.js";
import "../styles/connect-agent.css";

export function ConnectAgentPanel() {
  const serverUrl = useConnectionStore((s) => s.serverUrl);

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
    <div className="connect-agent">
      <div className="connect-agent-icon">{">"}_</div>
      <h3 className="connect-agent-title">Connect your agent</h3>
      <p className="connect-agent-subtitle">
        Run this command in your project directory to connect an AI coding agent.
        Your browser will open automatically to confirm the connection.
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
    </div>
  );
}
