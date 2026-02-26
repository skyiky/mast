/**
 * SessionControls — toolbar for chat header with abort, diff, revert.
 *
 * Ported from mobile's SessionConfigSheet but as an inline toolbar
 * (not a bottom sheet). The diff button opens the DiffView modal.
 */

import { useState, useCallback } from "react";
import { useSessionStore } from "../stores/sessions.js";
import { useApi } from "../hooks/useApi.js";
import { DiffView } from "./DiffView.js";
import type { ChatMessage } from "../lib/types.js";

interface SessionControlsProps {
  sessionId: string;
  /** Called after revert with the user's original prompt text to re-fill */
  onRevert?: (promptText: string) => void;
}

export function SessionControls({ sessionId, onRevert }: SessionControlsProps) {
  const api = useApi();

  const messages = useSessionStore(
    (s) => s.messagesBySession[sessionId] ?? [],
  );
  const setMessages = useSessionStore((s) => s.setMessages);
  const isStreaming = messages.some((m: ChatMessage) => m.streaming);

  const [aborting, setAborting] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  // Abort execution
  const handleAbort = useCallback(async () => {
    setAborting(true);
    try {
      await api.abort(sessionId);
    } catch {
      // best-effort
    } finally {
      setAborting(false);
    }
  }, [api, sessionId]);

  // Revert last response with confirmation
  const handleRevert = useCallback(async () => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m: ChatMessage) => m.role === "assistant");
    if (!lastAssistant) return;

    const assistantIdx = messages.findIndex((m) => m.id === lastAssistant.id);
    let userPromptText = "";
    if (assistantIdx > 0) {
      const preceding = messages[assistantIdx - 1];
      if (preceding.role === "user") {
        const textPart = preceding.parts.find((p) => p.type === "text");
        userPromptText = textPart?.content ?? "";
      }
    }

    const confirmed = window.confirm(
      "Revert the agent's last response? This will undo any file changes it made.",
    );
    if (!confirmed) return;

    setReverting(true);
    try {
      await api.revert(sessionId, lastAssistant.id);

      // Remove assistant + preceding user message locally
      const updated = messages.filter((m) => {
        if (m.id === lastAssistant.id) return false;
        if (
          assistantIdx > 0 &&
          m.id === messages[assistantIdx - 1].id &&
          m.role === "user"
        )
          return false;
        return true;
      });
      setMessages(sessionId, updated);

      if (userPromptText && onRevert) {
        onRevert(userPromptText);
      }
    } catch {
      // best-effort
    } finally {
      setReverting(false);
    }
  }, [api, sessionId, messages, setMessages, onRevert]);

  return (
    <>
      <div className="session-controls">
        {/* Abort — only enabled when streaming */}
        <button
          className="ctrl-btn danger"
          onClick={handleAbort}
          disabled={!isStreaming || aborting}
          title="Abort execution"
        >
          {aborting ? "..." : "abort"}
        </button>

        {/* Diff */}
        <button
          className="ctrl-btn"
          onClick={() => setDiffOpen(true)}
          title="View file diffs"
        >
          diff
        </button>

        {/* Revert */}
        <button
          className="ctrl-btn warning"
          onClick={handleRevert}
          disabled={messages.length === 0 || reverting}
          title="Revert last response"
        >
          {reverting ? "..." : "revert"}
        </button>
      </div>

      {/* Diff modal */}
      {diffOpen && (
        <DiffView
          sessionId={sessionId}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </>
  );
}
