import { useConnectionStore } from "../stores/connection.js";
import "../styles/components.css";

export function ConnectionBanner() {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);

  // All good — hide banner
  if (wsConnected && daemonConnected && opencodeReady) return null;

  let message = "";
  let severity: "danger" | "warning" = "danger";

  if (!wsConnected) {
    message = "Connecting to orchestrator...";
  } else if (!daemonConnected) {
    message = "Daemon disconnected";
  } else if (!opencodeReady) {
    message = "OpenCode starting...";
    severity = "warning";
  }

  return (
    <div className={`connection-banner ${severity}`}>
      <span className={`status-dot ${severity}`} />
      <span className="connection-text">{message}</span>
    </div>
  );
}
