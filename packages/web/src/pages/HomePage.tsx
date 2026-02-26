/**
 * HomePage — shown at `/` when no session is selected.
 * Displays a welcome message and prominent new session button.
 * Sessions are now shown in the sidebar, not here.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessions } from "../hooks/useSessions.js";

export function HomePage() {
  const navigate = useNavigate();
  const { createSession } = useSessions();

  const handleNewSession = useCallback(async () => {
    const id = await createSession();
    if (id) navigate(`/chat/${id}`);
  }, [createSession, navigate]);

  return (
    <div className="home-page">
      <div className="home-content">
        <h1 className="home-title">mast</h1>
        <p className="home-subtitle">mobile ai session terminal</p>
        <p className="home-hint">
          Select a session from the sidebar, or start a new one.
        </p>
        <button className="home-new-btn" onClick={handleNewSession}>
          + new session
        </button>
      </div>
    </div>
  );
}
