import { useState } from "react";
import { useConnectionStore } from "../stores/connection.js";
import { createApiBinding } from "../hooks/useApi.js";
import "../styles/pair.css";

export function PairPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);
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
