import type { WebSocket as WsWebSocket } from "ws";
import {
  type OrchestratorCommand,
  type CommandResult,
  type EventMessage,
  type DaemonMessage,
  type DaemonStatus,
  type HeartbeatAck,
  type SyncRequest,
  type SyncResponse,
  type PairRequest,
  generateRequestId,
} from "@mast/shared";

const REQUEST_TIMEOUT_MS = 120_000;

interface PendingRequest {
  resolve: (value: { status: "ok" | "error"; data?: unknown; error?: string }) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DaemonConnection {
  private ws: WsWebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  /** Callback for forwarding events (e.g., to phone clients) */
  onEvent?: (event: EventMessage) => void;

  /** Callback for daemon status updates */
  onStatus?: (status: DaemonStatus) => void;

  /** Callback for sync responses from daemon */
  onSyncResponse?: (response: SyncResponse) => void;

  /** Callback for pairing requests from daemon */
  onPairRequest?: (request: PairRequest) => void;

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

  /** Send a raw message to the daemon (used for sync_request, pair_response, etc.) */
  sendRaw(msg: unknown): void {
    if (this.ws) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Send a semantic command to the daemon and wait for the result.
   * The command must include a requestId for correlation.
   */
  sendCommand(
    command: OrchestratorCommand,
  ): Promise<{ status: "ok" | "error"; data?: unknown; error?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Daemon not connected"));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(command.requestId);
        reject(new Error(`Request ${command.requestId} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(command.requestId, { resolve, reject, timer });

      this.ws.send(JSON.stringify(command));
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
      case "command_result": {
        const result = msg as CommandResult;
        const pending = this.pendingRequests.get(result.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(result.requestId);
          pending.resolve({
            status: result.status,
            data: result.data,
            error: result.error,
          });
        } else {
          console.warn(
            `[orchestrator] received result for unknown request: ${result.requestId}`,
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
        const statusMsg = msg as DaemonStatus;
        const agentSummary = statusMsg.agents
          .map((a) => `${a.type}=${a.ready ? "ready" : "not ready"}`)
          .join(", ");
        console.log(
          `[orchestrator] daemon status: agentReady=${statusMsg.agentReady} (${agentSummary})`,
        );
        if (this.onStatus) {
          this.onStatus(statusMsg);
        }
        break;
      }

      case "event": {
        const eventMsg = msg as EventMessage;
        if (this.onEvent) {
          this.onEvent(eventMsg);
        }
        console.log(`[orchestrator] daemon event: ${eventMsg.event.type}`);
        break;
      }

      case "sync_response": {
        const syncResponse = msg as SyncResponse;
        if (this.onSyncResponse) {
          this.onSyncResponse(syncResponse);
        }
        console.log(`[orchestrator] sync_response received (${syncResponse.sessions.length} sessions)`);
        break;
      }

      case "pair_request": {
        const pairRequest = msg as PairRequest;
        if (this.onPairRequest) {
          this.onPairRequest(pairRequest);
        }
        console.log(`[orchestrator] pair_request received`);
        break;
      }

      default: {
        console.warn("[orchestrator] unknown daemon message type:", (msg as { type: string }).type);
      }
    }
  }
}

export const daemonConnection = new DaemonConnection();
