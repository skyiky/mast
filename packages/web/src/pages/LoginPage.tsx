import { useState } from "react";
import { useConnectionStore } from "../stores/connection.js";
import "../styles/login.css";

export function LoginPage() {
  const [url, setUrl] = useState("http://localhost:3000");
  const setServerUrl = useConnectionStore((s) => s.setServerUrl);
  const setApiToken = useConnectionStore((s) => s.setApiToken);
  const setAuthReady = useConnectionStore((s) => s.setAuthReady);

  const handleConnect = () => {
    if (!url.trim()) return;
    setServerUrl(url.trim().replace(/\/+$/, ""));
    // Dev-mode hardcoded token (same as mobile dev flow)
    setApiToken("mast-api-token-phase1");
    setAuthReady(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConnect();
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">mast</h1>
        <p className="login-subtitle">Mobile AI Session Terminal</p>

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
          onClick={handleConnect}
          disabled={!url.trim()}
        >
          Connect (Dev Mode)
        </button>
      </div>
    </div>
  );
}
