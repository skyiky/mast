/**
 * Manages WebSocket connections from phone clients, scoped by userId.
 *
 * Phones connect to /ws to receive streamed events (agent activity, message updates).
 * Each user's phones are tracked separately so events are only broadcast to
 * the user whose daemon generated them.
 */

import type { WebSocket as WsWebSocket } from "ws";
import WebSocket from "ws";
import type { EventMessage } from "@mast/shared";

export interface PhoneStatusMessage {
  type: "status";
  daemonConnected: boolean;
  opencodeReady: boolean;
}

export class PhoneConnectionManager {
  /** userId → Set of connected phone WebSockets */
  private clients = new Map<string, Set<WsWebSocket>>();

  add(userId: string, ws: WsWebSocket): void {
    let userSet = this.clients.get(userId);
    if (!userSet) {
      userSet = new Set();
      this.clients.set(userId, userSet);
    }
    userSet.add(ws);
    console.log(`[orchestrator] phone connected for user ${userId} (total: ${this.totalCount()})`);
  }

  remove(userId: string, ws: WsWebSocket): void {
    const userSet = this.clients.get(userId);
    if (userSet) {
      userSet.delete(ws);
      if (userSet.size === 0) {
        this.clients.delete(userId);
      }
    }
    console.log(`[orchestrator] phone disconnected for user ${userId} (total: ${this.totalCount()})`);
  }

  /** Broadcast an event to all connected phones for a specific user */
  broadcast(userId: string, event: EventMessage): void {
    const userSet = this.clients.get(userId);
    if (!userSet || userSet.size === 0) return;

    const data = JSON.stringify(event);
    for (const client of userSet) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** Send a status message to a single phone client */
  sendStatus(ws: WsWebSocket, status: PhoneStatusMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(status));
    }
  }

  /** Broadcast a status message to all connected phones for a specific user */
  broadcastStatus(userId: string, status: PhoneStatusMessage): void {
    const userSet = this.clients.get(userId);
    if (!userSet || userSet.size === 0) return;

    const data = JSON.stringify(status);
    for (const client of userSet) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** Check if a specific user has any connected phones */
  hasConnectedPhones(userId: string): boolean {
    const userSet = this.clients.get(userId);
    return userSet !== undefined && userSet.size > 0;
  }

  /** Count phones for a specific user */
  countForUser(userId: string): number {
    return this.clients.get(userId)?.size ?? 0;
  }

  /** Total number of connected phone clients across all users */
  totalCount(): number {
    let total = 0;
    for (const userSet of this.clients.values()) {
      total += userSet.size;
    }
    return total;
  }

  /**
   * Total count — backward-compatible with old code that called count().
   * In multi-user context, prefer totalCount() or countForUser(userId).
   */
  count(): number {
    return this.totalCount();
  }

  /** Close all phone connections across all users */
  closeAll(): void {
    for (const userSet of this.clients.values()) {
      for (const client of userSet) {
        client.close();
      }
    }
    this.clients.clear();
  }
}
