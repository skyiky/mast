/**
 * SemanticRelay — WSS client that connects to the orchestrator and dispatches
 * semantic commands to the AgentRouter.
 *
 * Replaces the old HTTP-relay pattern. Instead of proxying raw HTTP requests
 * to OpenCode, it receives typed commands (list_sessions, send_prompt, etc.)
 * and routes them through the AgentRouter to the appropriate adapter.
 */

import WebSocket from "ws";
import {
  type OrchestratorCommand,
  type OrchestratorMessage,
  type CommandResult,
  type EventMessage,
  type DaemonStatus,
  type Heartbeat,
  type SyncRequest,
  type SyncResponse,
  HARDCODED_DEVICE_KEY,
} from "@mast/shared";
import type { AgentRouter } from "./agent-router.js";
import type { MastEvent } from "./agent-adapter.js";

export class SemanticRelay {
  private ws: WebSocket | null = null;
  private orchestratorUrl: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private _deviceKey: string;
  private router: AgentRouter;

  constructor(orchestratorUrl: string, router: AgentRouter, deviceKey?: string) {
    this.orchestratorUrl = orchestratorUrl;
    this.router = router;
    this._deviceKey = deviceKey ?? HARDCODED_DEVICE_KEY;

    // Subscribe to events from all adapters and forward to orchestrator
    this.router.onEvent((event: MastEvent) => {
      const msg: EventMessage = {
        type: "event",
        event: {
          type: event.type,
          sessionId: event.sessionId,
          data: event.data,
        },
        timestamp: event.timestamp,
      };
      this.send(msg);
    });
  }

  async connect(): Promise<void> {
    const wsUrl = `${this.orchestratorUrl}/daemon?token=${this._deviceKey}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("Connected to orchestrator");
        this.ws = ws;
        this.reconnecting = false;
        this.reconnectAttempt = 0;

        // Send initial status with agent info
        this.sendStatus();

        // Start heartbeat
        this.startHeartbeat();

        resolve();
      });

      ws.on("message", async (data: WebSocket.RawData) => {
        try {
          await this.handleMessage(data.toString());
        } catch (err) {
          console.error("Error handling message:", err);
        }
      });

      ws.on("close", (code, reason) => {
        console.log(
          `WebSocket closed (code=${code}, reason=${reason.toString()})`,
        );
        this.stopHeartbeat();
        this.ws = null;

        if (this.shouldReconnect) {
          this.reconnect();
        }
      });

      ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
        if (!this.ws) {
          reject(err);
        }
      });
    });
  }

  private async handleMessage(data: string): Promise<void> {
    let msg: OrchestratorMessage;
    try {
      msg = JSON.parse(data) as OrchestratorMessage;
    } catch {
      console.error("Failed to parse message:", data);
      return;
    }

    switch (msg.type) {
      // -- Semantic commands --
      case "list_sessions":
      case "create_session":
      case "send_prompt":
      case "approve_permission":
      case "deny_permission":
      case "get_messages":
      case "get_diff":
      case "abort_session":
        await this.handleCommand(msg as OrchestratorCommand);
        break;

      // -- Infrastructure --
      case "heartbeat_ack":
        break;

      case "sync_request":
        await this.handleSyncRequest(msg as SyncRequest);
        break;

      case "pair_response":
        // Handled by daemon index.ts if pairing is active
        break;

      default:
        console.warn("Unknown message type:", (msg as { type: string }).type);
    }
  }

  private async handleCommand(command: OrchestratorCommand): Promise<void> {
    let result: CommandResult;

    try {
      switch (command.type) {
        case "list_sessions": {
          const sessions = await this.router.listSessions();
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
            data: sessions,
          };
          break;
        }

        case "create_session": {
          const session = await this.router.createSession(command.agentType);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
            data: session,
          };
          break;
        }

        case "send_prompt": {
          // Fire-and-forget — response streams back via events
          this.router.sendPrompt(command.sessionId, command.text);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
          };
          break;
        }

        case "approve_permission": {
          this.router.approvePermission(command.sessionId, command.permissionId);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
          };
          break;
        }

        case "deny_permission": {
          this.router.denyPermission(command.sessionId, command.permissionId);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
          };
          break;
        }

        case "get_messages": {
          const messages = await this.router.getMessages(command.sessionId);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
            data: messages,
          };
          break;
        }

        case "get_diff": {
          const diff = await this.router.getDiff(command.sessionId);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
            data: diff,
          };
          break;
        }

        case "abort_session": {
          await this.router.abortSession(command.sessionId);
          result = {
            type: "command_result",
            requestId: command.requestId,
            status: "ok",
          };
          break;
        }

        default: {
          result = {
            type: "command_result",
            requestId: (command as { requestId: string }).requestId,
            status: "error",
            error: `Unknown command type: ${(command as { type: string }).type}`,
          };
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`[relay] Command error (${command.type}):`, errorMessage);
      result = {
        type: "command_result",
        requestId: command.requestId,
        status: "error",
        error: errorMessage,
      };
    }

    this.send(result);
  }

  /** Send the current agent status to the orchestrator. */
  sendStatus(): void {
    const agents = this.router.getAgents();
    const status: DaemonStatus = {
      type: "status",
      agentReady: agents.some((a) => a.ready),
      agents,
    };
    this.send(status);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const heartbeat: Heartbeat = {
        type: "heartbeat",
        timestamp: new Date().toISOString(),
      };
      this.send(heartbeat);
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const baseDelay = 1000;
    const maxDelay = 30_000;

    while (this.shouldReconnect) {
      const exponentialDelay = Math.min(
        baseDelay * Math.pow(2, this.reconnectAttempt),
        maxDelay,
      );
      const jitter = exponentialDelay * Math.random() * 0.3;
      const delay = exponentialDelay + jitter;

      this.reconnectAttempt++;
      console.log(
        `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})...`,
      );

      await sleep(delay);

      if (!this.shouldReconnect) break;

      try {
        await this.connect();
        return;
      } catch {
        console.error("Reconnection attempt failed");
      }
    }

    this.reconnecting = false;
  }

  private async handleSyncRequest(request: SyncRequest): Promise<void> {
    // Sync works by querying each adapter for messages in cached sessions.
    // We iterate session IDs, determine which adapter owns them, and fetch messages.
    const sessions: SyncResponse["sessions"] = [];

    for (const sessionId of request.cachedSessionIds) {
      try {
        // Use router.getMessages() which falls back to the default adapter
        // when session ownership is unknown (e.g., after daemon restart with
        // a fresh router that hasn't seen these sessions yet).
        const messages = await this.router.getMessages(sessionId);

        // Filter to messages newer than lastEventTimestamp
        // Note: MastMessage doesn't have createdAt, so include all messages
        // for now. The orchestrator already has older ones cached.
        if (messages.length > 0) {
          sessions.push({
            id: sessionId,
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role,
              parts: m.parts ?? [],
              completed: m.completed,
            })),
          });
        }
      } catch (err) {
        console.error(
          `[relay] sync: error fetching session ${sessionId}:`,
          err,
        );
      }
    }

    const response: SyncResponse = {
      type: "sync_response",
      sessions,
    };
    this.send(response);
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      if (ws.readyState === WebSocket.CLOSED) return;

      await new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.close();
        const timer = setTimeout(resolve, 2000);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
