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
import type { SseEvent } from "./sse-client.js";
import type { ProjectManager } from "./project-manager.js";

/** Error thrown when the orchestrator rejects the device key (HTTP 401). */
export class AuthError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number) {
    super(`Orchestrator rejected device key (HTTP ${statusCode})`);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export class Relay {
  private ws: WebSocket | null = null;
  private orchestratorUrl: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private _deviceKey: string;
  private projectManager: ProjectManager;

  constructor(
    orchestratorUrl: string,
    projectManager: ProjectManager,
    deviceKey?: string,
  ) {
    this.orchestratorUrl = orchestratorUrl;
    this.projectManager = projectManager;
    this._deviceKey = deviceKey ?? HARDCODED_DEVICE_KEY;
  }

  async connect(): Promise<void> {
    const wsUrl = `${this.orchestratorUrl}/daemon?token=${this._deviceKey}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let rejected = false;

      ws.on("upgrade", () => {
        // Connection upgraded successfully — auth accepted
      });

      // Fires before 'error' when server responds with non-101 status
      ws.on("unexpected-response", (_req, res) => {
        rejected = true;
        if (res.statusCode === 401) {
          // Auth failure — don't reconnect with the same bad key
          this.shouldReconnect = false;
          reject(new AuthError(res.statusCode));
        } else {
          reject(new Error(`Unexpected server response: ${res.statusCode}`));
        }
        ws.close();
      });

      ws.on("open", () => {
        console.log("Connected to orchestrator");
        this.ws = ws;
        this.reconnecting = false;
        this.reconnectAttempt = 0;

        // Send initial status — report ready only if all projects are ready
        const status: DaemonStatus = {
          type: "status",
          opencodeReady: this.projectManager.allReady,
        };
        this.send(status);

        // Start heartbeat
        this.startHeartbeat();

        // Start SSE subscriptions for all projects
        this.projectManager.startAllSse();

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
        this.projectManager.stopAllSse();
        this.ws = null;

        if (this.shouldReconnect) {
          this.reconnect();
        }
      });

      ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
        // If we haven't connected yet and unexpected-response didn't already handle it
        if (!this.ws && !rejected) {
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

  /**
   * Route an HTTP request to the correct OpenCode instance (or handle internally).
   *
   * Routing rules:
   *   GET  /session           → aggregate listAllSessions() from ProjectManager
   *   POST /session           → route to project specified in body.project
   *   /session/:id/*          → lookup session→project mapping, forward to that instance
   *   GET  /project           → list managed projects (internal)
   *   POST /project           → add project (internal)
   *   DELETE /project/:name   → remove project (internal)
   *   Everything else         → forward to first ready project (fallback for /global/health etc.)
   */
  private async relayRequest(request: HttpRequest): Promise<void> {
    try {
      const { method, path } = request;

      // --- Project management endpoints (internal) ---
      if (path === "/project" || path.startsWith("/project/")) {
        await this.handleProjectRequest(request);
        return;
      }

      // --- MCP server listing (aggregate from all projects) ---
      if (method === "GET" && path === "/mcp-servers") {
        const mcpServers = await this.projectManager.listAllMcpServers();
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 200,
          body: mcpServers,
        } satisfies HttpResponse);
        return;
      }

      // --- Session listing (aggregate) ---
      if (method === "GET" && path === "/session") {
        const sessions = await this.projectManager.listAllSessions();
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 200,
          body: sessions,
        } satisfies HttpResponse);
        return;
      }

      // --- Session creation (route to specified project) ---
      if (method === "POST" && path === "/session") {
        const baseUrl = await this.resolveBaseUrlForNewSession(request);
        if (!baseUrl) {
          this.send({
            type: "http_response",
            requestId: request.requestId,
            status: 400,
            body: { error: "No project specified or project not found" },
          } satisfies HttpResponse);
          return;
        }
        await this.forwardRequest(request, baseUrl);
        return;
      }

      // --- Session-scoped requests (route by session ID) ---
      const sessionMatch = path.match(/^\/session\/([^/]+)/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        let baseUrl = this.projectManager.getBaseUrlForSession(sessionId);
        if (!baseUrl) {
          // Session not in routing map — try refreshing
          await this.projectManager.listAllSessions();
          baseUrl = this.projectManager.getBaseUrlForSession(sessionId);
        }
        if (!baseUrl) {
          // Still not found — fall back to first ready project.
          // This handles the common single-project case where the session
          // exists in OpenCode but hasn't been listed yet.
          baseUrl = this.getFirstReadyBaseUrl();
        }
        if (!baseUrl) {
          this.send({
            type: "http_response",
            requestId: request.requestId,
            status: 404,
            body: { error: `Session "${sessionId}" not found in any project` },
          } satisfies HttpResponse);
          return;
        }
        await this.forwardRequest(request, baseUrl);
        return;
      }

      // --- Fallback: forward to first ready project (e.g., /global/health) ---
      const fallbackUrl = this.getFirstReadyBaseUrl();
      if (fallbackUrl) {
        await this.forwardRequest(request, fallbackUrl);
      } else {
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 503,
          body: { error: "No projects are ready" },
        } satisfies HttpResponse);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `Relay error for ${request.method} ${request.path}:`,
        errorMessage,
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

  /**
   * Forward an HTTP request to a specific OpenCode instance's base URL.
   */
  private async forwardRequest(
    request: HttpRequest,
    baseUrl: string,
  ): Promise<void> {
    let url = `${baseUrl}${request.path}`;
    if (request.query && Object.keys(request.query).length > 0) {
      const params = new URLSearchParams(request.query);
      url += `?${params.toString()}`;
    }

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

    // If this was a session creation, register the new session
    if (
      request.method === "POST" &&
      request.path === "/session" &&
      res.ok &&
      body &&
      typeof body === "object" &&
      "id" in body
    ) {
      const sessionId = (body as { id: string }).id;
      const projectName = this.resolveProjectNameFromBody(request.body);
      if (projectName) {
        this.projectManager.registerSession(sessionId, projectName);
      }
    }

    const response: HttpResponse = {
      type: "http_response",
      requestId: request.requestId,
      status: res.status,
      body,
    };
    this.send(response);
  }

  /**
   * Handle project management requests (internal, not forwarded to OpenCode).
   *
   *   GET    /project         → list projects
   *   POST   /project         → add project { name, directory }
   *   DELETE /project/:name   → remove project
   */
  private async handleProjectRequest(request: HttpRequest): Promise<void> {
    const { method, path } = request;

    // GET /project — list
    if (method === "GET" && path === "/project") {
      const projects = this.projectManager.listProjects();
      this.send({
        type: "http_response",
        requestId: request.requestId,
        status: 200,
        body: projects,
      } satisfies HttpResponse);
      return;
    }

    // POST /project — add
    if (method === "POST" && path === "/project") {
      const body = request.body as { name?: string; directory?: string } | undefined;
      if (!body?.name || !body?.directory) {
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 400,
          body: { error: "name and directory are required" },
        } satisfies HttpResponse);
        return;
      }

      try {
        const managed = await this.projectManager.addProject(body.name, body.directory);
        // Start SSE + health for the new project
        this.projectManager.startSse(body.name);
        this.projectManager.startHealth(body.name);

        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 201,
          body: {
            name: managed.name,
            directory: managed.directory,
            port: managed.port,
            ready: managed.ready,
          },
        } satisfies HttpResponse);

        // Broadcast updated readiness — the health monitor won't fire
        // onStateChange for a newly added ready project (starts "healthy")
        this.send({
          type: "status",
          opencodeReady: this.projectManager.allReady,
        } satisfies DaemonStatus);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 409,
          body: { error: message },
        } satisfies HttpResponse);
      }
      return;
    }

    // DELETE /project/:name — remove
    const deleteMatch = path.match(/^\/project\/(.+)$/);
    if (method === "DELETE" && deleteMatch) {
      const projectName = decodeURIComponent(deleteMatch[1]);
      try {
        await this.projectManager.removeProject(projectName);
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 200,
          body: { removed: projectName },
        } satisfies HttpResponse);

        // Broadcast updated readiness — removing a project changes allReady
        this.send({
          type: "status",
          opencodeReady: this.projectManager.allReady,
        } satisfies DaemonStatus);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        this.send({
          type: "http_response",
          requestId: request.requestId,
          status: 404,
          body: { error: message },
        } satisfies HttpResponse);
      }
      return;
    }

    // Unknown project route
    this.send({
      type: "http_response",
      requestId: request.requestId,
      status: 404,
      body: { error: "Unknown project endpoint" },
    } satisfies HttpResponse);
  }

  /**
   * Resolve the OpenCode base URL for a new session creation.
   * Looks for `project` field in the request body.
   * If only one project exists, uses that one (no project field needed).
   */
  private async resolveBaseUrlForNewSession(
    request: HttpRequest,
  ): Promise<string | null> {
    const projectName = this.resolveProjectNameFromBody(request.body);

    if (projectName) {
      return this.projectManager.getBaseUrlForProject(projectName);
    }

    // If only one project, use it implicitly
    const projects = this.projectManager.listProjects();
    if (projects.length === 1) {
      return this.projectManager.getBaseUrlForProject(projects[0].name);
    }

    return null;
  }

  /**
   * Extract project name from a request body (if present).
   */
  private resolveProjectNameFromBody(body: unknown): string | null {
    if (body && typeof body === "object" && "project" in body) {
      return (body as { project: string }).project;
    }
    return null;
  }

  /**
   * Get the base URL of the first ready project (fallback for unscoped requests).
   */
  private getFirstReadyBaseUrl(): string | null {
    const projects = this.projectManager.listProjects();
    for (const p of projects) {
      if (p.ready) {
        return this.projectManager.getBaseUrlForProject(p.name);
      }
    }
    return null;
  }

  /**
   * Start health monitoring for all projects.
   * Wires health state changes to send DaemonStatus over WSS.
   */
  startHealthMonitoring(): void {
    this.projectManager.startAllHealth();
  }

  /**
   * Stop health monitoring for all projects.
   */
  stopHealthMonitoring(): void {
    this.projectManager.stopAllHealth();
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
      // Add jitter: random 0-30% of delay
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
        return; // connected successfully
      } catch {
        console.error("Reconnection attempt failed");
      }
    }

    this.reconnecting = false;
  }

  /**
   * Handle sync request — iterate all projects' sessions.
   * For each cached session ID, find which project owns it and
   * fetch missed messages from that project's OpenCode instance.
   */
  private async handleSyncRequest(request: SyncRequest): Promise<void> {
    const sessions: SyncResponse["sessions"] = [];

    for (const sessionId of request.cachedSessionIds) {
      // Find which project owns this session
      let baseUrl = this.projectManager.getBaseUrlForSession(sessionId);
      if (!baseUrl) {
        // Try refreshing session maps
        await this.projectManager.listAllSessions();
        baseUrl = this.projectManager.getBaseUrlForSession(sessionId);
      }
      if (!baseUrl) {
        // Still not found — fall back to first ready project (single-project case)
        baseUrl = this.getFirstReadyBaseUrl();
      }
      if (!baseUrl) {
        // Session no longer exists in any project — skip
        continue;
      }

      try {
        const res = await fetch(`${baseUrl}/session/${sessionId}/message`);

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

  send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.projectManager.stopAllSse();
    this.projectManager.stopAllHealth();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      if (ws.readyState === WebSocket.CLOSED) return;

      await new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.close();
        // Safety timeout — don't hang forever if close event never fires
        const timer = setTimeout(resolve, 2000);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
