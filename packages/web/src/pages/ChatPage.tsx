/**
 * ChatPage — message list with auto-scroll and text input.
 * Fetches messages on mount, renders MessageBubbles and PermissionCards.
 * Handles optimistic send (adds user message immediately, sends via API).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../stores/sessions.js";
import { useSettingsStore } from "../stores/settings.js";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "../hooks/useApi.js";
import { MessageBubble } from "../components/MessageBubble.js";
import { PermissionCard } from "../components/PermissionCard.js";
import { SessionControls } from "../components/SessionControls.js";
import type { ChatMessage } from "../lib/types.js";
import { mapApiMessages } from "../lib/types.js";
import "../styles/chat.css";

/** Stable empty array — avoids infinite re-render loop with useSyncExternalStore
 *  when the selector fallback creates a new [] reference each render. */
const EMPTY_MESSAGES: ChatMessage[] = [];

export function ChatPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const verbosity = useSettingsStore((s) => s.verbosity);

  const messages = useSessionStore(
    (s) => (sessionId ? s.messagesBySession[sessionId] : undefined) ?? EMPTY_MESSAGES,
  );
  const permissions = useSessionStore(useShallow((s) =>
    s.permissions.filter((p) => p.sessionId === sessionId),
  ));
  const setMessages = useSessionStore((s) => s.setMessages);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const addMessage = useSessionStore((s) => s.addMessage);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Set active session on mount, clear on unmount
  useEffect(() => {
    if (sessionId) setActiveSessionId(sessionId);
    return () => setActiveSessionId(null);
  }, [sessionId, setActiveSessionId]);

  // Fetch messages on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function load() {
      const res = await api.messages(sessionId!);
      if (cancelled) return;
      if (res.status === 200 && Array.isArray(res.body)) {
        const mapped = mapApiMessages(res.body);
        setMessages(sessionId!, mapped);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [sessionId, api, setMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!input.trim() || !sessionId || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);

    // Optimistic add
    const optimisticMsg: ChatMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text }],
      streaming: false,
      createdAt: new Date().toISOString(),
    };
    addMessage(sessionId, optimisticMsg);

    try {
      await api.prompt(sessionId, text);
    } catch {
      // Best-effort — message is already visible
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sessionId, sending, api, addMessage]);

  // Handle Enter to send (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Permission handlers
  const handleApprove = useCallback(
    (permId: string) => {
      if (sessionId) api.approve(sessionId, permId);
    },
    [sessionId, api],
  );

  const handleDeny = useCallback(
    (permId: string) => {
      if (sessionId) api.deny(sessionId, permId);
    },
    [sessionId, api],
  );

  // Re-fill input when revert restores the user's prompt
  const handleRevertRestore = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  if (!sessionId) {
    navigate("/");
    return null;
  }

  // Interleave permissions inline with messages (at the end)
  const pendingPerms = permissions.filter((p) => p.status === "pending");

  return (
    <div className="chat-page">
      {/* Header with session controls */}
      <div className="chat-header">
        <button
          className="chat-back-btn"
          onClick={() => navigate("/")}
          title="Back to home"
        >
          {"\u2190"}
        </button>
        <div className="chat-header-spacer" />
        <SessionControls
          sessionId={sessionId}
          onRevert={handleRevertRestore}
        />
      </div>

      {/* Message list */}
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Start a conversation by typing below.
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            verbosity={verbosity}
          />
        ))}

        {/* Pending permissions at the bottom */}
        {pendingPerms.map((perm) => (
          <PermissionCard
            key={perm.id}
            permission={perm}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        ))}
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={sending}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          send
        </button>
      </div>
    </div>
  );
}
