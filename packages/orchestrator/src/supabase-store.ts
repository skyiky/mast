/**
 * SupabaseSessionStore — Production implementation of SessionStore.
 *
 * Uses the Supabase service role key (bypasses RLS) and manually scopes
 * all queries by user_id extracted from the validated JWT.
 *
 * Schema (after 002_multi_user.sql migration):
 *
 *   sessions:    id (text PK), user_id (uuid), title, status, created_at, updated_at
 *   messages:    id (text PK), session_id (FK), role, parts (jsonb), streaming, created_at
 *   push_tokens: token (text PK), user_id (uuid), created_at
 *   device_keys: key (text PK), user_id (uuid), name, paired_at, last_seen
 *
 * Writes on the streaming path are fire-and-forget — the caller does NOT
 * await the DB write before forwarding events to the phone.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SessionStore, StoredSession, StoredMessage } from "./session-store.js";

export class SupabaseSessionStore implements SessionStore {
  private client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.client = createClient(supabaseUrl, supabaseKey);
  }

  async upsertSession(
    userId: string,
    session: { id: string; title?: string; status?: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from("sessions").upsert(
      {
        id: session.id,
        user_id: userId,
        title: session.title ?? null,
        status: session.status ?? "active",
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("[supabase] upsertSession error:", error.message);
    }
  }

  async listSessions(userId: string): Promise<StoredSession[]> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[supabase] listSessions error:", error.message);
      return [];
    }

    return (data ?? []).map(mapSession);
  }

  async getSession(userId: string, id: string): Promise<StoredSession | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      console.error("[supabase] getSession error:", error.message);
      return null;
    }

    return data ? mapSession(data) : null;
  }

  async addMessage(
    userId: string,
    msg: { id: string; sessionId: string; role: string; parts: unknown[] },
  ): Promise<void> {
    // Ensure session exists (owned by this user)
    await this.upsertSession(userId, { id: msg.sessionId });

    const { error } = await this.client.from("messages").upsert(
      {
        id: msg.id,
        session_id: msg.sessionId,
        role: msg.role,
        parts: JSON.stringify(msg.parts),
        streaming: true,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("[supabase] addMessage error:", error.message);
    }
  }

  async updateMessageParts(id: string, parts: unknown[]): Promise<void> {
    const { error } = await this.client
      .from("messages")
      .update({ parts: JSON.stringify(parts) })
      .eq("id", id);

    if (error) {
      console.error("[supabase] updateMessageParts error:", error.message);
    }
  }

  async upsertMessagePart(
    id: string,
    part: Record<string, unknown>,
  ): Promise<void> {
    // Read current parts from DB
    const { data, error: readErr } = await this.client
      .from("messages")
      .select("parts")
      .eq("id", id)
      .single();

    if (readErr || !data) {
      // Message may not exist yet (race with addMessage). Silently skip.
      if (readErr && readErr.code !== "PGRST116") {
        console.error("[supabase] upsertMessagePart read error:", readErr.message);
      }
      return;
    }

    let parts: unknown[];
    if (typeof data.parts === "string") {
      try {
        parts = JSON.parse(data.parts);
      } catch {
        parts = [];
      }
    } else if (Array.isArray(data.parts)) {
      parts = data.parts;
    } else {
      parts = [];
    }

    // Upsert by part.id if present
    const partId = part.id as string | undefined;
    if (partId) {
      const idx = parts.findIndex(
        (p) => (p as Record<string, unknown>).id === partId,
      );
      if (idx >= 0) {
        parts[idx] = part;
      } else {
        parts.push(part);
      }
    } else {
      parts.push(part);
    }

    const { error: writeErr } = await this.client
      .from("messages")
      .update({ parts: JSON.stringify(parts) })
      .eq("id", id);

    if (writeErr) {
      console.error("[supabase] upsertMessagePart write error:", writeErr.message);
    }
  }

  async markMessageComplete(id: string): Promise<void> {
    const { error } = await this.client
      .from("messages")
      .update({ streaming: false })
      .eq("id", id);

    if (error) {
      console.error("[supabase] markMessageComplete error:", error.message);
    }
  }

  async getMessages(sessionId: string): Promise<StoredMessage[]> {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[supabase] getMessages error:", error.message);
      return [];
    }

    return (data ?? []).map(mapMessage);
  }

  async savePushToken(userId: string, token: string): Promise<void> {
    const { error } = await this.client.from("push_tokens").upsert(
      { token, user_id: userId },
      { onConflict: "token" },
    );
    if (error) {
      console.error("[supabase] savePushToken error:", error.message);
    }
  }

  async getPushTokens(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("push_tokens")
      .select("token")
      .eq("user_id", userId);

    if (error) {
      console.error("[supabase] getPushTokens error:", error.message);
      return [];
    }

    return (data ?? []).map((row) => row.token as string);
  }

  // ---------------------------------------------------------------------------
  // Device key helpers (not part of SessionStore interface)
  // ---------------------------------------------------------------------------

  /** Look up the userId for a device key. Returns null if not found. */
  async resolveDeviceKey(key: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("device_keys")
      .select("user_id")
      .eq("key", key)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      console.error("[supabase] resolveDeviceKey error:", error.message);
      return null;
    }

    return data?.user_id ?? null;
  }

  /** Save a new device key binding. */
  async saveDeviceKey(key: string, userId: string, name?: string): Promise<void> {
    const { error } = await this.client.from("device_keys").upsert(
      { key, user_id: userId, name: name ?? null },
      { onConflict: "key" },
    );
    if (error) {
      console.error("[supabase] saveDeviceKey error:", error.message);
    }
  }

  /** Update last_seen timestamp for a device key. */
  async touchDeviceKey(key: string): Promise<void> {
    const { error } = await this.client
      .from("device_keys")
      .update({ last_seen: new Date().toISOString() })
      .eq("key", key);
    if (error) {
      console.error("[supabase] touchDeviceKey error:", error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case → camelCase)
// ---------------------------------------------------------------------------

function mapSession(row: Record<string, unknown>): StoredSession {
  return {
    id: row.id as string,
    title: (row.title as string) ?? undefined,
    status: (row.status as string) ?? "active",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapMessage(row: Record<string, unknown>): StoredMessage {
  let parts: unknown[];
  if (typeof row.parts === "string") {
    try {
      parts = JSON.parse(row.parts);
    } catch {
      parts = [];
    }
  } else if (Array.isArray(row.parts)) {
    parts = row.parts;
  } else {
    parts = [];
  }

  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as string,
    parts,
    streaming: row.streaming as boolean,
    createdAt: row.created_at as string,
  };
}
