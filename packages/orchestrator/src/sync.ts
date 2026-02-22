// Sync protocol for the Mast orchestrator.
// After a daemon reconnects, the orchestrator sends a sync_request with the IDs of
// cached sessions and the timestamp of the last event it received. The daemon queries
// OpenCode and responds with any missed messages.

import type { SyncRequest, SyncResponse, EventMessage } from "@mast/shared";
import type { SessionStore } from "./session-store.js";
import type { PhoneConnectionManager } from "./phone-connections.js";

/**
 * Build a sync_request message from the current session store state.
 */
export async function buildSyncRequest(
  store: SessionStore,
  lastEventTimestamp: string,
): Promise<SyncRequest> {
  const sessions = await store.listSessions();
  return {
    type: "sync_request",
    cachedSessionIds: sessions.map((s) => s.id),
    lastEventTimestamp,
  };
}

/**
 * Process a sync_response from the daemon: backfill missed messages into the store
 * and broadcast them to any connected phone clients.
 */
export async function processSyncResponse(
  response: SyncResponse,
  store: SessionStore,
  phoneConnections: PhoneConnectionManager,
): Promise<void> {
  for (const session of response.sessions) {
    // Upsert session in case it's new — include title if available
    const sess = session as Record<string, unknown>;
    await store.upsertSession({
      id: session.id,
      title: (sess.slug ?? sess.title) as string | undefined,
    });

    for (const msg of session.messages) {
      // Add the missed message
      await store.addMessage({
        id: msg.id,
        sessionId: session.id,
        role: msg.role,
        parts: msg.parts,
      });

      // If it was already completed, mark it
      if (msg.completed) {
        await store.markMessageComplete(msg.id);
      }

      // Broadcast to phone clients as a synthetic event
      const event: EventMessage = {
        type: "event",
        event: {
          type: "message.created",
          data: {
            sessionID: session.id,
            message: {
              id: msg.id,
              role: msg.role,
            },
          },
        },
        timestamp: new Date().toISOString(),
      };
      phoneConnections.broadcast(event);
    }
  }
}

/**
 * Tracks the timestamp of the last event received from the daemon.
 * Used to build sync_request messages after reconnection.
 */
export class EventTimestampTracker {
  private lastTimestamp: string = new Date(0).toISOString();

  update(timestamp: string): void {
    this.lastTimestamp = timestamp;
  }

  get(): string {
    return this.lastTimestamp;
  }

  reset(): void {
    this.lastTimestamp = new Date(0).toISOString();
  }
}
