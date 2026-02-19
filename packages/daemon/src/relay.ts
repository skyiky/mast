import WebSocket from "ws";
import {
  type HttpRequest,
  type HttpResponse,
  type EventMessage,
  type OrchestratorMessage,
  type DaemonStatus,
  type Heartbeat,
  type SyncRequest,
  type SyncResponse,
  HARDCODED_DEVICE_KEY,
} from "@mast/shared";
import { SseSubscriber, type SseEvent } from "./sse-client.js";
import { HealthMonitor } from "./health-monitor.js";

export class Relay {
  private ws: WebSocket | null = null;
  private opencodeBaseUrl: string;
  private orchestratorUrl: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private sseSubscriber: SseSubscriber | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private _deviceKey: string;

  constructor(orchestratorUrl: string, opencodeBaseUrl: string, deviceKey?: string) {
    this.orchestratorUrl = orchestratorUrl;
    this.opencodeBaseUrl = opencodeBaseUrl;
    this._deviceKey = deviceKey ?? HARDCODED_DEVICE_KEY;
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

        // Send initial status
        const status: DaemonStatus = {
          type: "status",
          opencodeReady: true,
        };
        this.send(status);

        // Start heartbeat
        this.startHeartbeat();

        // Start SSE subscription to OpenCode events
        this.startSseSubscription();

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
          `WebSocket closed (code=${code}, reason=${reason.toString()})`
        );
        this.stopHeartbeat();
        this.stopSseSubscription();
        this.ws = null;

        if (this.shouldReconnect) {
          this.reconnect();
        }
      });

      ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
        // If we haven't connected yet, reject the promise
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
      case "http_request":
        await this.relayRequest(msg);
        break;
      case "heartbeat_ack":
        // Heartbeat acknowledged by orchestrator
        break;
      case "sync_request":
        await this.handleSyncRequest(msg as SyncRequest);
        break;
      default:
        console.warn("Unknown message type:", (msg as { type: string }).type);
    }
  }

  private async relayRequest(request: HttpRequest): Promise<void> {
    try {
      // Build URL
      let url = `${this.opencodeBaseUrl}${request.path}`;
      if (request.query && Object.keys(request.query).length > 0) {
        const params = new URLSearchParams(request.query);
        url += `?${params.toString()}`;
      }

      // Build fetch options
      const fetchOptions: RequestInit = {
        method: request.method,
      };

      if (
        request.body !== undefined &&
        ["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())
      ) {
        fetchOptions.body = JSON.stringify(request.body);
        fetchOptions.headers = {
          "Content-Type": "application/json",
        };
      }

      const res = await fetch(url, fetchOptions);

      // Read response body
      let body: unknown;
      const text = await res.text();
      if (text.length === 0) {
        body = null;
      } else {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      const response: HttpResponse = {
        type: "http_response",
        requestId: request.requestId,
        status: res.status,
        body,
      };
      this.send(response);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `Relay error for ${request.method} ${request.path}:`,
        errorMessage
      );

      const response: HttpResponse = {
        type: "http_response",
        requestId: request.requestId,
        status: 502,
        body: { error: "Bad Gateway", message: errorMessage },
      };
      this.send(response);
    }
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
        maxDelay
      );
      // Add jitter: random 0-30% of delay
      const jitter = exponentialDelay * Math.random() * 0.3;
      const delay = exponentialDelay + jitter;

      this.reconnectAttempt++;
      console.log(
        `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})...`
      );

      await sleep(delay);

      if (!this.shouldReconnect) break;

      try {
        await this.connect();
        return; // connected successfully
      } catch {
        console.error("Reconnection attempt failed");
      }
    }

    this.reconnecting = false;
  }

  private startSseSubscription(): void {
    this.stopSseSubscription();
    this.sseSubscriber = new SseSubscriber(this.opencodeBaseUrl);

    // Fire and forget — the subscriber runs until stopped
    this.sseSubscriber.subscribe((event: SseEvent) => {
      const msg: EventMessage = {
        type: "event",
        event: {
          type: event.type,
          data: event.data,
        },
        timestamp: new Date().toISOString(),
      };
      this.send(msg);
    }).catch((err) => {
      console.error("[relay] SSE subscription error:", err);
    });

    console.log("[relay] SSE subscription started");
  }

  private stopSseSubscription(): void {
    if (this.sseSubscriber) {
      this.sseSubscriber.stop();
      this.sseSubscriber = null;
    }
  }

  private async handleSyncRequest(request: SyncRequest): Promise<void> {
    const sessions: SyncResponse["sessions"] = [];

    for (const sessionId of request.cachedSessionIds) {
      try {
        const res = await fetch(
          `${this.opencodeBaseUrl}/session/${sessionId}/message`,
        );

        if (res.status === 404) {
          // Session deleted — skip (orchestrator will handle)
          continue;
        }

        if (!res.ok) {
          console.error(
            `[relay] sync: failed to fetch messages for ${sessionId}: ${res.status}`,
          );
          continue;
        }

        const allMessages = (await res.json()) as Array<{
          id: string;
          role: string;
          parts: unknown[];
          completed?: boolean;
          createdAt?: string;
        }>;

        // Filter to messages newer than lastEventTimestamp
        const cutoff = new Date(request.lastEventTimestamp).getTime();
        const missed = allMessages.filter((m) => {
          if (!m.createdAt) return true; // if no timestamp, include it
          return new Date(m.createdAt).getTime() > cutoff;
        });

        if (missed.length > 0) {
          sessions.push({
            id: sessionId,
            messages: missed.map((m) => ({
              id: m.id,
              role: m.role,
              parts: m.parts ?? [],
              completed: m.completed ?? true,
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

  /**
   * Start OpenCode health monitoring.
   * The health monitor periodically checks /global/health and fires callbacks
   * on state changes.
   */
  startHealthMonitor(config?: {
    checkIntervalMs?: number;
    failureThreshold?: number;
    onRecoveryNeeded?: () => Promise<void>;
  }): HealthMonitor {
    this.stopHealthMonitor();
    this.healthMonitor = new HealthMonitor({
      opencodeBaseUrl: this.opencodeBaseUrl,
      checkIntervalMs: config?.checkIntervalMs,
      failureThreshold: config?.failureThreshold,
      onStateChange: (_state, ready) => {
        const status: DaemonStatus = {
          type: "status",
          opencodeReady: ready,
        };
        this.send(status);
      },
      onRecoveryNeeded: config?.onRecoveryNeeded,
    });
    this.healthMonitor.start();
    return this.healthMonitor;
  }

  stopHealthMonitor(): void {
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
    }
  }

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.stopSseSubscription();
    this.stopHealthMonitor();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      if (ws.readyState === WebSocket.CLOSED) return;

      await new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.close();
        // Safety timeout — don't hang forever if close event never fires
        // Use unref() so this timer doesn't prevent process exit
        const timer = setTimeout(resolve, 2000);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
