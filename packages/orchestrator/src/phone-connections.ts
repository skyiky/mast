/**
 * Manages WebSocket connections from phone clients.
 *
 * Phones connect to /ws to receive streamed events (agent activity, message updates).
 * This manager tracks all connected phones and broadcasts events to them.
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
  private clients: Set<WsWebSocket> = new Set();

  add(ws: WsWebSocket): void {
    this.clients.add(ws);
    console.log(`[orchestrator] phone connected (total: ${this.clients.size})`);
  }

  remove(ws: WsWebSocket): void {
    this.clients.delete(ws);
    console.log(`[orchestrator] phone disconnected (total: ${this.clients.size})`);
  }

  /** Broadcast an event to all connected phone clients */
  broadcast(event: EventMessage): void {
    if (this.clients.size === 0) return;

    const data = JSON.stringify(event);
    for (const client of this.clients) {
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

  /** Broadcast a status message to all connected phone clients */
  broadcastStatus(status: PhoneStatusMessage): void {
    if (this.clients.size === 0) return;

    const data = JSON.stringify(status);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  count(): number {
    return this.clients.size;
  }

  /** Close all phone connections */
  closeAll(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }
}
