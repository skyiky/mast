import type { WebSocket as WsWebSocket } from "ws";
import {
  type HttpRequest,
  type HttpResponse,
  type DaemonMessage,
  type HeartbeatAck,
  generateRequestId,
} from "@mast/shared";

const REQUEST_TIMEOUT_MS = 120_000;

interface PendingRequest {
  resolve: (value: { status: number; body: unknown }) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DaemonConnection {
  private ws: WsWebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  setConnection(ws: WsWebSocket): void {
    this.ws = ws;
    console.log("[orchestrator] daemon connected");
  }

  clearConnection(): void {
    this.ws = null;
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Daemon disconnected"));
      this.pendingRequests.delete(id);
    }
    console.log("[orchestrator] daemon disconnected");
  }

  isConnected(): boolean {
    return this.ws !== null;
  }

  sendRequest(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Daemon not connected"));
        return;
      }

      const requestId = generateRequestId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const msg: HttpRequest = {
        type: "http_request",
        requestId,
        method,
        path,
        ...(body !== undefined && { body }),
        ...(query !== undefined && Object.keys(query).length > 0 && { query }),
      };

      this.ws.send(JSON.stringify(msg));
    });
  }

  handleMessage(data: string): void {
    let msg: DaemonMessage;
    try {
      msg = JSON.parse(data) as DaemonMessage;
    } catch {
      console.error("[orchestrator] failed to parse daemon message:", data);
      return;
    }

    switch (msg.type) {
      case "http_response": {
        const response = msg as HttpResponse;
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(response.requestId);
          pending.resolve({ status: response.status, body: response.body });
        } else {
          console.warn(
            `[orchestrator] received response for unknown request: ${response.requestId}`,
          );
        }
        break;
      }

      case "heartbeat": {
        const ack: HeartbeatAck = {
          type: "heartbeat_ack",
          timestamp: new Date().toISOString(),
        };
        if (this.ws) {
          this.ws.send(JSON.stringify(ack));
        }
        break;
      }

      case "status": {
        console.log(
          `[orchestrator] daemon status: opencodeReady=${msg.opencodeReady}` +
            (msg.opencodeVersion ? ` version=${msg.opencodeVersion}` : ""),
        );
        break;
      }

      case "event": {
        console.log(`[orchestrator] daemon event: ${msg.event.type}`);
        break;
      }

      default: {
        console.warn("[orchestrator] unknown daemon message type:", (msg as { type: string }).type);
      }
    }
  }
}

export const daemonConnection = new DaemonConnection();
