/**
 * OpenCodeAdapter — AgentAdapter implementation for OpenCode.
 *
 * Wraps the existing OpenCode integration (HTTP relay, SSE subscription,
 * health monitoring, process management) behind the AgentAdapter interface.
 *
 * OpenCode runs as a separate HTTP server on localhost. This adapter
 * communicates with it via fetch() for commands and SseSubscriber for events.
 */

import { BaseAdapter, type MastEvent, type MastEventType, type MastSession, type MastMessage } from "../agent-adapter.js";
import { OpenCodeProcess, type OpenCodeProcessConfig } from "../opencode-process.js";
import { SseSubscriber, type SseEvent } from "../sse-client.js";
import { HealthMonitor } from "../health-monitor.js";

// ---------------------------------------------------------------------------
// OpenCode SSE event type → Mast event type mapping
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP: Record<string, MastEventType> = {
  "message.created": "mast.message.created",
  "message.part.created": "mast.message.part.created",
  "message.part.updated": "mast.message.part.updated",
  "message.completed": "mast.message.completed",
  "permission.created": "mast.permission.created",
  "permission.updated": "mast.permission.updated",
  "session.updated": "mast.session.updated",
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OpenCodeAdapterConfig {
  port?: number;
  skipProcess?: boolean; // If true, don't manage the OpenCode process
  processConfig?: OpenCodeProcessConfig;
  healthCheckIntervalMs?: number;
  healthFailureThreshold?: number;
  onCrash?: (code: number | null, signal: string | null) => void;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenCodeAdapter extends BaseAdapter {
  readonly agentType = "opencode";

  private baseUrl: string;
  private process: OpenCodeProcess | null = null;
  private sseSubscriber: SseSubscriber | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private config: OpenCodeAdapterConfig;
  private _started = false;

  constructor(config?: OpenCodeAdapterConfig) {
    super();
    const port = config?.port ?? 4096;
    this.baseUrl = `http://localhost:${port}`;
    this.config = config ?? {};
  }

  // -- Lifecycle --

  async start(): Promise<void> {
    if (this._started) return;

    // Start OpenCode process (unless skipped)
    if (!this.config.skipProcess) {
      this.process = new OpenCodeProcess({
        port: this.config.port ?? 4096,
        ...this.config.processConfig,
        onCrash: this.config.onCrash,
      });
      await this.process.start();
      await this.process.waitForReady();
    }

    // Start SSE subscription
    this.startSseSubscription();

    // Start health monitoring
    this.startHealthMonitor();

    this._started = true;
    console.log("[opencode-adapter] Started");
  }

  async stop(): Promise<void> {
    this.stopSseSubscription();
    this.stopHealthMonitor();

    if (this.process) {
      await this.process.stop();
      this.process = null;
    }

    this._started = false;
    console.log("[opencode-adapter] Stopped");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/global/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  // -- Sessions --

  async listSessions(): Promise<MastSession[]> {
    const res = await fetch(`${this.baseUrl}/session`);
    if (!res.ok) {
      throw new Error(`Failed to list sessions: ${res.status}`);
    }
    const sessions = await res.json() as Array<{
      id: string;
      title?: string;
      createdAt?: string;
    }>;
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      agentType: "opencode" as const,
      createdAt: s.createdAt ?? new Date().toISOString(),
    }));
  }

  async createSession(): Promise<MastSession> {
    const res = await fetch(`${this.baseUrl}/session`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.status}`);
    }
    const session = await res.json() as { id: string; title?: string; createdAt?: string };
    return {
      id: session.id,
      title: session.title,
      agentType: "opencode",
      createdAt: session.createdAt ?? new Date().toISOString(),
    };
  }

  // -- Messaging --

  sendPrompt(sessionId: string, text: string): void {
    // Fire-and-forget — response streams back via SSE events
    const body = { parts: [{ type: "text", text }] };
    fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err) => {
      console.error(`[opencode-adapter] sendPrompt error:`, err);
    });
  }

  async abortSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new Error(`Failed to abort session: ${res.status}`);
    }
  }

  async getMessages(sessionId: string): Promise<MastMessage[]> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`);
    if (!res.ok) {
      throw new Error(`Failed to get messages: ${res.status}`);
    }
    const messages = await res.json() as Array<{
      id: string;
      role: string;
      parts: unknown[];
      completed?: boolean;
    }>;
    return messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: m.parts ?? [],
      completed: m.completed ?? true,
    }));
  }

  // -- Permissions --

  approvePermission(sessionId: string, permissionId: string): void {
    fetch(`${this.baseUrl}/session/${sessionId}/permissions/${permissionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    }).catch((err) => {
      console.error(`[opencode-adapter] approvePermission error:`, err);
    });
  }

  denyPermission(sessionId: string, permissionId: string): void {
    fetch(`${this.baseUrl}/session/${sessionId}/permissions/${permissionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: false }),
    }).catch((err) => {
      console.error(`[opencode-adapter] denyPermission error:`, err);
    });
  }

  // -- Diff --

  async getDiff(sessionId: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/diff`);
    if (!res.ok) {
      throw new Error(`Failed to get diff: ${res.status}`);
    }
    return res.json();
  }

  // -- Process management (OpenCode-specific) --

  /** Restart the underlying OpenCode process. */
  async restart(): Promise<void> {
    if (this.process) {
      await this.process.restart();
    }
  }

  /** Get the OpenCode base URL. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  // -- Internal: SSE --

  private startSseSubscription(): void {
    this.stopSseSubscription();
    this.sseSubscriber = new SseSubscriber(this.baseUrl);

    this.sseSubscriber
      .subscribe((event: SseEvent) => {
        const mastType = EVENT_TYPE_MAP[event.type];
        if (!mastType) {
          console.warn(`[opencode-adapter] Unknown SSE event type: ${event.type}`);
          return;
        }

        const data = event.data as Record<string, unknown> ?? {};
        const sessionId = (data.sessionID as string) ?? "";

        const mastEvent: MastEvent = {
          type: mastType,
          sessionId,
          data,
          timestamp: new Date().toISOString(),
        };

        this.emitEvent(mastEvent);
      })
      .catch((err) => {
        console.error("[opencode-adapter] SSE subscription error:", err);
      });
  }

  private stopSseSubscription(): void {
    if (this.sseSubscriber) {
      this.sseSubscriber.stop();
      this.sseSubscriber = null;
    }
  }

  // -- Internal: Health Monitor --

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthMonitor = new HealthMonitor({
      opencodeBaseUrl: this.baseUrl,
      checkIntervalMs: this.config.healthCheckIntervalMs,
      failureThreshold: this.config.healthFailureThreshold,
      onStateChange: (_state, ready) => {
        // Emit a status-like event (the relay layer can pick this up)
        this.events.emit("health", { ready });
      },
      onRecoveryNeeded: async () => {
        if (this.process) {
          console.log("[opencode-adapter] Health monitor triggered recovery");
          await this.process.restart();
        }
      },
    });
    this.healthMonitor.start();
  }

  private stopHealthMonitor(): void {
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
    }
  }
}
