import { create } from "zustand";

export interface MessagePart {
  type: "text" | "tool-invocation" | "tool-result" | "reasoning" | "file";
  content: string;
  /** Tool name, if this is a tool-invocation or tool-result */
  toolName?: string;
  /** Tool arguments as JSON string */
  toolArgs?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  streaming: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  /** Human-readable session name from OpenCode (e.g., "happy-wizard") */
  title?: string;
  createdAt: string;
  updatedAt: string;
  /** Preview of last message (for session list) */
  lastMessagePreview?: string;
  /** Whether the session has unread messages */
  hasActivity?: boolean;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  description: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
}

interface SessionState {
  /** All known sessions */
  sessions: Session[];
  /** Messages keyed by session ID */
  messagesBySession: Record<string, ChatMessage[]>;
  /** Pending permission requests */
  permissions: PermissionRequest[];
  /** Whether we're loading sessions list */
  loadingSessions: boolean;
  /** Currently active session ID (for tracking which chat is open) */
  activeSessionId: string | null;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setLoadingSessions: (loading: boolean) => void;

  // Streaming message updates (called by WebSocket handler)
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessageParts: (sessionId: string, messageId: string, parts: MessagePart[]) => void;
  updateLastTextPart: (sessionId: string, messageId: string, text: string) => void;
  appendTextDelta: (sessionId: string, messageId: string, delta: string) => void;
  addPartToMessage: (sessionId: string, messageId: string, part: MessagePart) => void;
  markMessageComplete: (sessionId: string, messageId: string) => void;
  markAllStreamsComplete: () => void;

  // Permissions
  addPermission: (perm: PermissionRequest) => void;
  updatePermission: (permId: string, status: "approved" | "denied") => void;
  clearPermissions: (sessionId: string) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  messagesBySession: {},
  permissions: [],
  loadingSessions: false,
  activeSessionId: null,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => {
      if (state.sessions.find((s) => s.id === session.id)) return state;
      return { sessions: [session, ...state.sessions] };
    }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
    })),

  setActiveSessionId: (id) =>
    set((state) => ({
      activeSessionId: id,
      // Clear unread activity flag when user opens the session
      sessions: id
        ? state.sessions.map((s) =>
            s.id === id && s.hasActivity ? { ...s, hasActivity: false } : s,
          )
        : state.sessions,
    })),
  setLoadingSessions: (loading) => set({ loadingSessions: loading }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const existing = state.messagesBySession[sessionId] ?? [];
      // Don't add duplicates
      if (existing.find((m) => m.id === message.id)) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message],
        },
        // Mark session as having unread activity (if not the active session)
        sessions: state.sessions.map((s) =>
          s.id === sessionId && s.id !== state.activeSessionId
            ? { ...s, hasActivity: true }
            : s,
        ),
      };
    }),

  updateMessageParts: (sessionId, messageId, parts) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) =>
            m.id === messageId ? { ...m, parts } : m,
          ),
        },
      };
    }),

  updateLastTextPart: (sessionId, messageId, text) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) => {
            if (m.id !== messageId) return m;
            const newParts = [...m.parts];
            const textIdx = newParts.findIndex((p) => p.type === "text");
            if (textIdx >= 0) {
              // Guard: don't overwrite non-empty content with empty string.
              // OpenCode's "streaming start" signal sends text: "" which can
              // arrive as a duplicate (from SSE reconnection replay) AFTER
              // real content has been accumulated via deltas.
              if (text === "" && newParts[textIdx].content) {
                return m;
              }
              newParts[textIdx] = { ...newParts[textIdx], content: text };
            } else {
              newParts.push({ type: "text", content: text });
            }
            return { ...m, parts: newParts };
          }),
        },
      };
    }),

  appendTextDelta: (sessionId, messageId, delta) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) => {
            if (m.id !== messageId) return m;
            const newParts = [...m.parts];
            const textIdx = newParts.findIndex((p) => p.type === "text");
            if (textIdx >= 0) {
              newParts[textIdx] = {
                ...newParts[textIdx],
                content: newParts[textIdx].content + delta,
              };
            } else {
              newParts.push({ type: "text", content: delta });
            }
            return { ...m, parts: newParts };
          }),
        },
      };
    }),

  addPartToMessage: (sessionId, messageId, part) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) => {
            if (m.id !== messageId) return m;
            return { ...m, parts: [...m.parts, part] };
          }),
        },
      };
    }),

  markMessageComplete: (sessionId, messageId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) =>
            m.id === messageId ? { ...m, streaming: false } : m,
          ),
        },
      };
    }),

  markAllStreamsComplete: () =>
    set((state) => {
      // Only create a new state object if there are actually streaming
      // messages. Returning the same state reference avoids unnecessary
      // re-renders — this is critical because this function is called on
      // every WebSocket disconnect (including during reconnect loops).
      const hasStreaming = Object.values(state.messagesBySession).some(
        (msgs) => msgs.some((m) => m.streaming),
      );
      if (!hasStreaming) return state;

      const updated: Record<string, ChatMessage[]> = {};
      for (const [sid, msgs] of Object.entries(state.messagesBySession)) {
        updated[sid] = msgs.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
      }
      return { messagesBySession: updated };
    }),

  addPermission: (perm) =>
    set((state) => ({
      permissions: [...state.permissions, perm],
    })),

  updatePermission: (permId, status) =>
    set((state) => ({
      permissions: state.permissions.map((p) =>
        p.id === permId ? { ...p, status } : p,
      ),
    })),

  clearPermissions: (sessionId) =>
    set((state) => ({
      permissions: state.permissions.filter((p) => p.sessionId !== sessionId),
    })),
}));
