import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MessagePart {
  type: "text" | "tool-invocation" | "tool-result" | "reasoning" | "file";
  content: string;
  /** Tool name, if this is a tool-invocation or tool-result */
  toolName?: string;
  /** Tool arguments as JSON string */
  toolArgs?: string;
  /** OpenCode tool call ID — used to upsert tool parts as they progress
   *  through lifecycle states (pending → running → completed). */
  callID?: string;
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
  /** Human-readable session nickname from OpenCode (e.g., "happy-wizard") */
  title?: string;
  /** Working directory the agent is operating in */
  directory?: string;
  /** Project name this session belongs to (from multi-project daemon) */
  project?: string;
  createdAt: string;
  updatedAt: string;
  /** Last user prompt text (truncated, for session list preview) */
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
  /** Session IDs the user has deleted locally. Persisted via AsyncStorage so
   *  they stay hidden across app restarts even though the server still
   *  returns them in GET /sessions. */
  deletedSessionIds: string[];

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  /** Remove a session from the local list (e.g. user swipe-to-delete). */
  removeSession: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setLoadingSessions: (loading: boolean) => void;

  // Streaming message updates (called by WebSocket handler)
  addMessage: (sessionId: string, message: ChatMessage) => void;
  /** Remove a message by ID (e.g. roll back an optimistic send on error). */
  removeMessage: (sessionId: string, messageId: string) => void;
  updateMessageParts: (sessionId: string, messageId: string, parts: MessagePart[]) => void;
  updateLastTextPart: (sessionId: string, messageId: string, text: string) => void;
  appendTextDelta: (sessionId: string, messageId: string, delta: string) => void;
  addPartToMessage: (sessionId: string, messageId: string, part: MessagePart) => void;
  /** Upsert a tool part by callID — updates existing part in-place if a
   *  matching callID is found, otherwise appends as new. This prevents
   *  duplicate tool cards when OpenCode sends multiple lifecycle updates
   *  (pending → running → completed) for the same tool call. */
  upsertToolPart: (sessionId: string, messageId: string, part: MessagePart) => void;
  markMessageComplete: (sessionId: string, messageId: string) => void;
  markAllStreamsComplete: () => void;

  // Permissions
  addPermission: (perm: PermissionRequest) => void;
  updatePermission: (permId: string, status: "approved" | "denied") => void;
  clearPermissions: (sessionId: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
  sessions: [],
  messagesBySession: {},
  permissions: [],
  loadingSessions: false,
  activeSessionId: null,
  deletedSessionIds: [],

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => {
      if (state.sessions.find((s) => s.id === session.id)) return state;
      return { sessions: [session, ...state.sessions] };
    }),

  removeSession: (sessionId) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      deletedSessionIds: state.deletedSessionIds.includes(sessionId)
        ? state.deletedSessionIds
        : [...state.deletedSessionIds, sessionId],
      // Also clean up messages for the deleted session
      messagesBySession: (() => {
        const { [sessionId]: _, ...rest } = state.messagesBySession;
        return rest;
      })(),
    })),

  setMessages: (sessionId, messages) =>
    set((state) => {
      // Derive last user prompt preview from loaded messages
      const lastUserMsg = findLastUserMessage(messages);
      return {
        messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
        sessions: lastUserMsg
          ? state.sessions.map((s) =>
              s.id === sessionId
                ? { ...s, lastMessagePreview: lastUserMsg }
                : s,
            )
          : state.sessions,
      };
    }),

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

      // Extract preview from user messages
      const preview =
        message.role === "user"
          ? message.parts.find((p) => p.type === "text")?.content
          : undefined;

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message],
        },
        // Mark session as having unread activity (if not the active session)
        // and update preview if this is a user message
        sessions: state.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            ...(s.id !== state.activeSessionId ? { hasActivity: true } : {}),
            ...(preview ? { lastMessagePreview: preview } : {}),
          };
        }),
      };
    }),

  removeMessage: (sessionId, messageId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.filter((m) => m.id !== messageId),
        },
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

  upsertToolPart: (sessionId, messageId, part) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) => {
            if (m.id !== messageId) return m;
            if (part.callID) {
              const idx = m.parts.findIndex((p) => p.callID === part.callID);
              if (idx >= 0) {
                // Update existing tool part in-place
                const newParts = [...m.parts];
                newParts[idx] = part;
                return { ...m, parts: newParts };
              }
            }
            // No matching callID found — append as new part
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
    }),
    {
      name: "mast-deleted-sessions",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the deleted session IDs — everything else is transient
      partialize: (state) => ({ deletedSessionIds: state.deletedSessionIds }),
    },
  ),
);

/** Find the text content of the last user message in a list. */
function findLastUserMessage(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].parts.find((p) => p.type === "text")?.content;
    }
  }
  return undefined;
}
