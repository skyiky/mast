/**
 * SessionStore — Interface and InMemorySessionStore for Phase 3.
 *
 * The SessionStore abstracts session/message persistence.
 * - InMemorySessionStore: used in tests (fast, deterministic)
 * - SupabaseSessionStore: used in production (supabase-store.ts)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredSession {
  id: string;
  title?: string;
  status: string; // "active" | "completed" | "error"
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: string; // "user" | "assistant"
  parts: unknown[];
  streaming: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SessionStore {
  upsertSession(session: {
    id: string;
    title?: string;
    status?: string;
  }): Promise<void>;

  listSessions(): Promise<StoredSession[]>;

  getSession(id: string): Promise<StoredSession | null>;

  addMessage(msg: {
    id: string;
    sessionId: string;
    role: string;
    parts: unknown[];
  }): Promise<void>;

  updateMessageParts(id: string, parts: unknown[]): Promise<void>;

  markMessageComplete(id: string): Promise<void>;

  getMessages(sessionId: string): Promise<StoredMessage[]>;

  savePushToken(token: string): Promise<void>;

  getPushTokens(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, StoredSession>();
  private messages = new Map<string, StoredMessage>();
  private pushTokens = new Set<string>();

  async upsertSession(session: {
    id: string;
    title?: string;
    status?: string;
  }): Promise<void> {
    const existing = this.sessions.get(session.id);
    const now = new Date().toISOString();
    if (existing) {
      this.sessions.set(session.id, {
        ...existing,
        ...(session.title !== undefined ? { title: session.title } : {}),
        ...(session.status !== undefined ? { status: session.status } : {}),
        updatedAt: now,
      });
    } else {
      this.sessions.set(session.id, {
        id: session.id,
        title: session.title,
        status: session.status ?? "active",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async listSessions(): Promise<StoredSession[]> {
    return Array.from(this.sessions.values()).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async getSession(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async addMessage(msg: {
    id: string;
    sessionId: string;
    role: string;
    parts: unknown[];
  }): Promise<void> {
    // Ensure session exists
    if (!this.sessions.has(msg.sessionId)) {
      await this.upsertSession({ id: msg.sessionId });
    }
    this.messages.set(msg.id, {
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role,
      parts: msg.parts,
      streaming: true,
      createdAt: new Date().toISOString(),
    });
  }

  async updateMessageParts(id: string, parts: unknown[]): Promise<void> {
    const msg = this.messages.get(id);
    if (msg) {
      this.messages.set(id, { ...msg, parts });
    }
  }

  async markMessageComplete(id: string): Promise<void> {
    const msg = this.messages.get(id);
    if (msg) {
      this.messages.set(id, { ...msg, streaming: false });
    }
  }

  async getMessages(sessionId: string): Promise<StoredMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }

  async savePushToken(token: string): Promise<void> {
    this.pushTokens.add(token);
  }

  async getPushTokens(): Promise<string[]> {
    return Array.from(this.pushTokens);
  }

  /** Clear all push tokens (useful for test isolation). */
  clearPushTokens(): void {
    this.pushTokens.clear();
  }
}
