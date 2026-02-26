/**
 * ConfirmDaemonPage — browser confirmation for daemon pairing.
 *
 * The daemon opens this page automatically after starting in pairing mode.
 * Shows daemon info (hostname, projects) and an Approve/Deny prompt.
 * Also renders a QR code encoding a deep link for mobile app pairing.
 *
 * URL: /confirm-daemon?code=<6-digit-code>
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useConnectionStore } from "../stores/connection.js";
import * as api from "../lib/api.js";
import "../styles/confirm-daemon.css";

interface PendingInfo {
  hostname: string | null;
  projects: string[];
  createdAt: number;
}

type PageState =
  | { kind: "loading" }
  | { kind: "info"; pending: PendingInfo }
  | { kind: "approving" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function ConfirmDaemonPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get("code") ?? "";

  const serverUrl = useConnectionStore((s) => s.serverUrl);
  const apiToken = useConnectionStore((s) => s.apiToken);

  const [state, setState] = useState<PageState>({ kind: "loading" });

  // Fetch pending pairing info on mount
  useEffect(() => {
    if (!code) {
      setState({ kind: "error", message: "No pairing code provided" });
      return;
    }

    const config: api.ApiConfig = { serverUrl, apiToken };
    api.getPendingPairing(config, code).then((res) => {
      if (res.status === 200 && res.body) {
        setState({ kind: "info", pending: res.body });
      } else if (res.status === 404) {
        setState({
          kind: "error",
          message: "Pairing code not found or expired. Restart the daemon to try again.",
        });
      } else {
        setState({ kind: "error", message: "Failed to load pairing info" });
      }
    }).catch(() => {
      setState({ kind: "error", message: "Connection failed" });
    });
  }, [code, serverUrl, apiToken]);

  const handleApprove = useCallback(async () => {
    setState({ kind: "approving" });
    try {
      const config: api.ApiConfig = { serverUrl, apiToken };
      const res = await api.verifyPairingCode(config, code);
      if (res.status === 200 && (res.body as any)?.success) {
        setState({ kind: "success" });
        // Redirect to session list after brief delay
        setTimeout(() => navigate("/", { replace: true }), 1500);
      } else {
        setState({
          kind: "error",
          message: (res.body as any)?.error === "code_expired"
            ? "Pairing code has expired. Restart the daemon to try again."
            : (res.body as any)?.error ?? "Pairing failed",
        });
      }
    } catch {
      setState({ kind: "error", message: "Connection failed" });
    }
  }, [code, serverUrl, apiToken, navigate]);

  const handleDeny = useCallback(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  // Deep link for mobile app QR scanning
  const mobileDeepLink = `mast://pair?code=${encodeURIComponent(code)}`;

  return (
    <div className="confirm-page">
      <div className="confirm-card">
        {state.kind === "loading" && (
          <>
            <div className="confirm-icon">&gt;_</div>
            <h2 className="confirm-title">Verifying pairing code...</h2>
          </>
        )}

        {state.kind === "info" && (
          <>
            <div className="confirm-icon">&gt;_</div>
            <h2 className="confirm-title">A daemon wants to connect</h2>

            <div className="confirm-details">
              <div className="confirm-detail-row">
                <span className="confirm-detail-label">Machine</span>
                <span className="confirm-detail-value">
                  {state.pending.hostname ?? "Unknown"}
                </span>
              </div>
              {state.pending.projects.length > 0 && (
                <div className="confirm-detail-row">
                  <span className="confirm-detail-label">
                    {state.pending.projects.length === 1 ? "Project" : "Projects"}
                  </span>
                  <span className="confirm-detail-value">
                    {state.pending.projects.join(", ")}
                  </span>
                </div>
              )}
            </div>

            <div className="confirm-actions">
              <button className="confirm-approve" onClick={handleApprove}>
                Approve
              </button>
              <button className="confirm-deny" onClick={handleDeny}>
                Deny
              </button>
            </div>

            <div className="confirm-divider">
              <span>or pair from mobile</span>
            </div>

            <div className="confirm-qr">
              <QRCodeSVG
                value={mobileDeepLink}
                size={160}
                bgColor="transparent"
                fgColor="#D4D4D4"
                level="M"
              />
              <p className="confirm-qr-hint">
                Scan with the Mast mobile app
              </p>
            </div>
          </>
        )}

        {state.kind === "approving" && (
          <>
            <div className="confirm-icon">&gt;_</div>
            <h2 className="confirm-title">Approving...</h2>
          </>
        )}

        {state.kind === "success" && (
          <>
            <div className="confirm-icon confirm-icon-success">&#10003;</div>
            <h2 className="confirm-title">Agent connected</h2>
            <p className="confirm-subtitle">Redirecting to sessions...</p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="confirm-icon confirm-icon-error">!</div>
            <h2 className="confirm-title">Pairing failed</h2>
            <p className="confirm-error">{state.message}</p>
            <button className="confirm-back" onClick={handleDeny}>
              Go to sessions
            </button>
          </>
        )}
      </div>
    </div>
  );
}
