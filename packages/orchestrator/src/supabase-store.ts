/**
 * SupabaseSessionStore — Production implementation of SessionStore.
 *
 * Thin adapter over @supabase/supabase-js that maps the SessionStore
 * interface to real Supabase Postgres tables.
 *
 * Schema (created manually in Supabase dashboard or via SQL):
 *
 *   sessions:    id (text PK), title, status, created_at, updated_at
 *   messages:    id (text PK), session_id (FK), role, parts (jsonb), streaming, created_at
 *   push_tokens: id (uuid PK), token (text unique), created_at
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

  async upsertSession(session: {
    id: string;
    title?: string;
    status?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from("sessions").upsert(
      {
        id: session.id,
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

  async listSessions(): Promise<StoredSession[]> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[supabase] listSessions error:", error.message);
      return [];
    }

    return (data ?? []).map(mapSession);
  }

  async getSession(id: string): Promise<StoredSession | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      console.error("[supabase] getSession error:", error.message);
      return null;
    }

    return data ? mapSession(data) : null;
  }

  async addMessage(msg: {
    id: string;
    sessionId: string;
    role: string;
    parts: unknown[];
  }): Promise<void> {
    // Ensure session exists
    await this.upsertSession({ id: msg.sessionId });

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

  async savePushToken(token: string): Promise<void> {
    const { error } = await this.client.from("push_tokens").upsert(
      { token },
      { onConflict: "token" },
    );
    if (error) {
      console.error("[supabase] savePushToken error:", error.message);
    }
  }

  async getPushTokens(): Promise<string[]> {
    const { data, error } = await this.client
      .from("push_tokens")
      .select("token");

    if (error) {
      console.error("[supabase] getPushTokens error:", error.message);
      return [];
    }

    return (data ?? []).map((row) => row.token as string);
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
