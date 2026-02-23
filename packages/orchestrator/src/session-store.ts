/**
 * SessionStore — Interface and InMemorySessionStore.
 *
 * The SessionStore abstracts session/message persistence.
 * - InMemorySessionStore: used in tests (fast, deterministic)
 * - SupabaseSessionStore: used in production (supabase-store.ts)
 *
 * All session-level and push-token methods require a userId parameter
 * for multi-user scoping. Message methods that operate by unique id
 * (markMessageComplete, upsertMessagePart, updateMessageParts) do not
 * require userId since message ids are globally unique.
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
  upsertSession(
    userId: string,
    session: { id: string; title?: string; status?: string },
  ): Promise<void>;

  listSessions(userId: string): Promise<StoredSession[]>;

  getSession(userId: string, id: string): Promise<StoredSession | null>;

  addMessage(
    userId: string,
    msg: { id: string; sessionId: string; role: string; parts: unknown[] },
  ): Promise<void>;

  updateMessageParts(id: string, parts: unknown[]): Promise<void>;

  /**
   * Upsert a single part into a message's parts array.
   * If a part with the same `id` field already exists, it is replaced in-place.
   * Otherwise the new part is appended. This prevents the "last write wins"
   * bug where step-finish events would overwrite text/tool content.
   */
  upsertMessagePart(id: string, part: Record<string, unknown>): Promise<void>;

  markMessageComplete(id: string): Promise<void>;

  getMessages(sessionId: string): Promise<StoredMessage[]>;

  savePushToken(userId: string, token: string): Promise<void>;

  getPushTokens(userId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, StoredSession & { userId: string }>();
  private messages = new Map<string, StoredMessage>();
  private pushTokens = new Map<string, Set<string>>(); // userId → Set<token>

  async upsertSession(
    userId: string,
    session: { id: string; title?: string; status?: string },
  ): Promise<void> {
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
        userId,
      });
    }
  }

  async listSessions(userId: string): Promise<StoredSession[]> {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  async getSession(userId: string, id: string): Promise<StoredSession | null> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return null;
    return session;
  }

  async addMessage(
    userId: string,
    msg: { id: string; sessionId: string; role: string; parts: unknown[] },
  ): Promise<void> {
    // Ensure session exists
    if (!this.sessions.has(msg.sessionId)) {
      await this.upsertSession(userId, { id: msg.sessionId });
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

  async upsertMessagePart(
    id: string,
    part: Record<string, unknown>,
  ): Promise<void> {
    const msg = this.messages.get(id);
    if (!msg) return;

    const partId = part.id as string | undefined;
    if (partId) {
      const idx = msg.parts.findIndex(
        (p) => (p as Record<string, unknown>).id === partId,
      );
      if (idx >= 0) {
        msg.parts[idx] = part;
      } else {
        msg.parts.push(part);
      }
    } else {
      msg.parts.push(part);
    }
    this.messages.set(id, { ...msg, parts: [...msg.parts] });
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

  async savePushToken(userId: string, token: string): Promise<void> {
    let tokens = this.pushTokens.get(userId);
    if (!tokens) {
      tokens = new Set();
      this.pushTokens.set(userId, tokens);
    }
    tokens.add(token);
  }

  async getPushTokens(userId: string): Promise<string[]> {
    return Array.from(this.pushTokens.get(userId) ?? []);
  }

  /** Clear all push tokens (useful for test isolation). */
  clearPushTokens(): void {
    this.pushTokens.clear();
  }
}
