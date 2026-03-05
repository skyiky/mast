/**
 * Mast Remote Control Plugin for OpenCode
 *
 * Enables remote control of OpenCode sessions via the Mast orchestrator.
 * User types /rc in the TUI to toggle remote control on/off.
 *
 * Architecture:
 *   OpenCode (localhost) ←SSE/HTTP→ [this plugin] ←WebSocket→ Orchestrator (cloud)
 *
 * First-time setup: /rc wss://your-orchestrator-url
 *   - Saves URL to ~/.mast/config.json
 *   - Starts browser-based pairing flow
 *   - Saves device key to ~/.mast/device-key.json
 *   - Connects relay
 *
 * Subsequent use: /rc (toggle on/off)
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir, hostname as osHostname, platform } from "node:os";
import { exec } from "node:child_process";

// SDK client type alias for readability
type SdkClient = PluginInput["client"];

// =============================================================================
// Protocol types (inlined from @mast/shared to keep plugin self-contained)
// =============================================================================

interface HttpRequest {
  type: "http_request";
  requestId: string;
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

interface HttpResponse {
  type: "http_response";
  requestId: string;
  status: number;
  body: unknown;
}

interface EventMessage {
  type: "event";
  event: { type: string; data: unknown };
  timestamp: string;
}

interface DaemonStatus {
  type: "status";
  opencodeReady: boolean;
}

interface Heartbeat {
  type: "heartbeat";
  timestamp: string;
}

interface PairRequest {
  type: "pair_request";
  pairingCode: string;
  hostname?: string;
  projects?: string[];
}

interface PairResponse {
  type: "pair_response";
  success: boolean;
  deviceKey?: string;
  error?: string;
}

interface SyncRequest {
  type: "sync_request";
  cachedSessionIds: string[];
  lastEventTimestamp: string;
}

interface SyncResponse {
  type: "sync_response";
  sessions: Array<{
    sessionId: string;
    messages: Array<{ id: string; role: string; parts: unknown[]; createdAt: string }>;
  }>;
}

type OrchestratorMessage = HttpRequest | { type: "heartbeat_ack" } | SyncRequest | PairResponse;

const MAST_DIR = join(homedir(), ".mast");

/** Debug logger — only prints when MAST_DEBUG env var is set */
const debug = (...args: unknown[]) => {
  if (process.env.MAST_DEBUG) console.log(...args);
};

// =============================================================================
// Config / Key file I/O
// =============================================================================

interface MastConfig {
  orchestratorUrl?: string;
}

async function loadConfig(): Promise<MastConfig> {
  try {
    const raw = await readFile(join(MAST_DIR, "config.json"), "utf-8");
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function saveConfig(config: MastConfig): Promise<void> {
  await mkdir(MAST_DIR, { recursive: true });
  const existing = await loadConfig();
  await writeFile(
    join(MAST_DIR, "config.json"),
    JSON.stringify({ ...existing, ...config }, null, 2),
    "utf-8",
  );
}

async function loadDeviceKey(): Promise<string | null> {
  try {
    const raw = await readFile(join(MAST_DIR, "device-key.json"), "utf-8");
    const data = JSON.parse(raw);
    return data?.deviceKey && typeof data.deviceKey === "string" ? data.deviceKey : null;
  } catch {
    return null;
  }
}

async function saveDeviceKey(deviceKey: string): Promise<void> {
  await mkdir(MAST_DIR, { recursive: true });
  await writeFile(
    join(MAST_DIR, "device-key.json"),
    JSON.stringify({ deviceKey, pairedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

const VISIBLE_SESSIONS_PATH = join(MAST_DIR, "visible-sessions.json");

async function loadVisibleSessions(): Promise<Set<string>> {
  try {
    const raw = await readFile(VISIBLE_SESSIONS_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data?.sessionIds && Array.isArray(data.sessionIds)) {
      return new Set(data.sessionIds.filter((id: unknown) => typeof id === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

async function saveVisibleSessions(ids: Set<string>): Promise<void> {
  await mkdir(MAST_DIR, { recursive: true });
  await writeFile(
    VISIBLE_SESSIONS_PATH,
    JSON.stringify({ sessionIds: [...ids], updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

// =============================================================================
// Browser opener
// =============================================================================

function openBrowser(url: string): void {
  const plat = platform();
  let cmd: string;
  if (plat === "win32") {
    cmd = `start "" "${url}"`;
  } else if (plat === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, () => {}); // fire-and-forget
}

function deriveWebUrl(orchestratorUrl: string): string {
  const override = process.env.MAST_WEB_URL;
  if (override) return override.replace(/\/+$/, "");
  return orchestratorUrl.replace(/^ws/, "http").replace(/\/+$/, "");
}

// =============================================================================
// Pairing flow
// =============================================================================

function generatePairingCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function runPairingFlow(
  orchestratorUrl: string,
  onStatus: (msg: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${orchestratorUrl}/daemon?token=pairing`;
    const ws = new WebSocket(wsUrl);
    const code = generatePairingCode();

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Pairing timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    ws.onopen = () => {
      const request: PairRequest = {
        type: "pair_request",
        pairingCode: code,
        hostname: osHostname(),
        projects: [],
      };
      ws.send(JSON.stringify(request));

      const webBase = deriveWebUrl(orchestratorUrl);
      const confirmUrl = `${webBase}/confirm-daemon?code=${encodeURIComponent(code)}`;
      openBrowser(confirmUrl);
      onStatus(`Opening browser for pairing... If it didn't open, visit: ${confirmUrl}`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as PairResponse;
        if (msg.type === "pair_response") {
          clearTimeout(timeout);
          if (msg.success && msg.deviceKey) {
            ws.close();
            resolve(msg.deviceKey);
          } else {
            ws.close();
            reject(new Error(`Pairing failed: ${msg.error ?? "unknown error"}`));
          }
        }
      } catch {
        // Ignore parse errors — wait for a valid pair_response
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Pairing connection failed"));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}

// =============================================================================
// Mini-relay: connects orchestrator ↔ OpenCode via WebSocket + SSE + HTTP proxy
// =============================================================================

class MiniRelay {
  private ws: WebSocket | null = null;
  private sseAbort: AbortController | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;

  /**
   * Reference to the module-level visible session set. Shared across
   * relay reconnections. Persisted to disk by the caller.
   */
  private readonly visibleSessionIds: Set<string>;

  constructor(
    private orchestratorUrl: string,
    private sdkClient: SdkClient,
    private deviceKey: string,
    private projectName: string,
    private projectDirectory: string,
    visibleSessionIds: Set<string>,
  ) {
    this.visibleSessionIds = visibleSessionIds;
  }

  /**
   * Resolve the OpenCode HTTP base URL from the SDK client's internal config.
   * Used ONLY for the generic fallback when no SDK method covers a route.
   */
  private get openCodeBaseUrl(): string {
    try {
      // The SDK client wraps a low-level @hey-api client that exposes getConfig()
      const internalClient = (this.sdkClient as any)._client;
      if (internalClient?.getConfig) {
        const cfg = internalClient.getConfig();
        if (cfg?.baseUrl) return cfg.baseUrl.replace(/\/+$/, "");
      }
    } catch {
      // Ignore — fall through to serverUrl-based default
    }
    return "http://localhost:4096";
  }

  private get openCodePort(): number {
    try {
      return new URL(this.openCodeBaseUrl).port ? Number(new URL(this.openCodeBaseUrl).port) : 4096;
    } catch {
      return 4096;
    }
  }

  async connect(): Promise<void> {
    const wsUrl = `${this.orchestratorUrl}/daemon?token=${this.deviceKey}`;
    debug(`[mast-relay] Connecting to orchestrator: ${wsUrl.replace(/token=.*/, "token=***")}`);
    debug(`[mast-relay] OpenCode base URL (from SDK): ${this.openCodeBaseUrl}`);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this.ws = ws;
        this.reconnectAttempt = 0;
        debug("[mast-relay] WebSocket connected to orchestrator");

        // Send initial status
        this.send({ type: "status", opencodeReady: true } satisfies DaemonStatus);

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
          this.send({ type: "heartbeat", timestamp: new Date().toISOString() } satisfies Heartbeat);
        }, 30_000);

        // Subscribe to OpenCode SSE events
        this.subscribeSse();

        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(
            typeof event.data === "string" ? event.data : String(event.data),
          ) as OrchestratorMessage;

          if (msg.type === "http_request") {
            this.handleHttpRequest(msg);
          } else if (msg.type === "sync_request") {
            this.handleSyncRequest(msg);
          }
          // heartbeat_ack handled silently
        } catch (err) {
          console.error("[mast-relay] Error parsing orchestrator message:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("[mast-relay] WebSocket error:", err);
        if (!this.ws) reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = (event) => {
        debug(`[mast-relay] WebSocket closed (code=${event.code}, reason=${event.reason})`);
        this.cleanup();
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Helper: raw HTTP fetch to OpenCode (ONLY for generic fallback routes
  // that have no SDK method). Uses the resolved base URL from SDK config.
  // ---------------------------------------------------------------------------
  private async fetchOpenCodeRaw(
    path: string,
    opts?: RequestInit,
  ): Promise<{ status: number; body: unknown }> {
    const url = `${this.openCodeBaseUrl}${path}`;
    const res = await fetch(url, opts);
    const text = await res.text();
    let body: unknown;
    if (text.length === 0) {
      body = null;
    } else {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------------
  // Extract an array from an API response that might be wrapped in an object.
  // Handles bare arrays, { sessions: [...] }, { data: [...] }, or single objects.
  // ---------------------------------------------------------------------------
  private static extractArray(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object") {
      // Try common wrapper keys
      const obj = body as Record<string, unknown>;
      for (const key of ["sessions", "data", "items", "results"]) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[];
      }
      // If it looks like a single session object (has an id), wrap in array
      if ("id" in obj) return [obj];
    }
    return [];
  }

  private async handleHttpRequest(req: HttpRequest): Promise<void> {
    debug(`[mast-relay] HTTP ${req.method} ${req.path}`);

    // --- Helper: reject requests for sessions not in the visible set ---
    const rejectIfNotVisible = (sessionId: string): boolean => {
      if (this.visibleSessionIds.has(sessionId)) return false;
      debug(`[mast-relay] Session ${sessionId} not in visible set — returning 404`);
      this.send({
        type: "http_response",
        requestId: req.requestId,
        status: 404,
        body: { error: "Session not found" },
      } satisfies HttpResponse);
      return true; // rejected
    };

    // --- Internal routes (handled by the relay, not forwarded to OpenCode) ---

    // GET /project — return synthetic project list
    if (req.method === "GET" && req.path === "/project") {
      const body = [{
        name: this.projectName,
        directory: this.projectDirectory,
        port: this.openCodePort,
        ready: true,
      }];
      debug(`[mast-relay] → 200 (synthetic project list)`);
      this.send({
        type: "http_response",
        requestId: req.requestId,
        status: 200,
        body,
      } satisfies HttpResponse);
      return;
    }

    // GET /session — use SDK client, enrich with project name
    if (req.method === "GET" && (req.path === "/session" || req.path === "/session/")) {
      try {
        const result = await this.sdkClient.session.list();
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.list() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: 500,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        const sessions = Array.isArray(data) ? data : MiniRelay.extractArray(data);

        // Deduplicate by session ID (defensive — prevents duplicates from
        // any source: leaked relays, SDK quirks, etc.). Keep first occurrence.
        const seen = new Set<string>();
        const deduped = sessions.filter((s: any) => {
          if (!s.id || seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        if (deduped.length !== sessions.length) {
          console.warn(`[mast-relay] Deduped sessions: ${sessions.length} → ${deduped.length}`);
        }

        // Filter to only sessions visible to the remote client
        const visible = deduped.filter((s: any) => this.visibleSessionIds.has(s.id));

        const enriched = visible.map((s: any) => ({
          ...s,
          project: this.projectName,
        }));
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: enriched,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error fetching sessions via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to fetch sessions: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // POST /session — use SDK client, enrich response with project name
    if (req.method === "POST" && (req.path === "/session" || req.path === "/session/")) {
      try {
        const result = await this.sdkClient.session.create({
          body: req.body as any,
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.create() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.create() → success`);
        // Enrich the new session with project name
        const body = data && typeof data === "object" && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>), project: this.projectName }
          : data;
        // Track the new session so it becomes visible to the remote client
        const newId = (data as any)?.id;
        if (newId) {
          this.visibleSessionIds.add(newId);
          saveVisibleSessions(this.visibleSessionIds).catch(() => {});
          debug(`[mast-relay] Added session ${newId} to visible set (now ${this.visibleSessionIds.size})`);
        }
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error creating session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to create session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // GET /session/:id/message — use SDK client
    const msgMatch = req.path.match(/^\/session\/([^/]+)\/message\/?$/);
    if (req.method === "GET" && msgMatch) {
      const sessionId = msgMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.messages({
          path: { id: sessionId },
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.messages() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 500,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.messages(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error fetching messages via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to fetch messages: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // POST /session/:id/prompt_async — use SDK client
    const promptMatch = req.path.match(/^\/session\/([^/]+)\/prompt_async\/?$/);
    if (req.method === "POST" && promptMatch) {
      const sessionId = promptMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.promptAsync({
          path: { id: sessionId },
          body: req.body as any,
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.promptAsync() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.promptAsync(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 204,
          body: data ?? null,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error sending prompt via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to send prompt: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // POST /session/:id/abort — use SDK client
    const abortMatch = req.path.match(/^\/session\/([^/]+)\/abort\/?$/);
    if (req.method === "POST" && abortMatch) {
      const sessionId = abortMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.abort({
          path: { id: sessionId },
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.abort() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.abort(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error aborting session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to abort session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // GET /session/:id/diff — use SDK client
    const diffMatch = req.path.match(/^\/session\/([^/]+)\/diff\/?$/);
    if (req.method === "GET" && diffMatch) {
      const sessionId = diffMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.diff({
          path: { id: sessionId },
          ...(req.query?.messageID ? { query: { messageID: req.query.messageID } } : {}),
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.diff() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.diff(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error fetching diff via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to fetch diff: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // POST /session/:id/permissions/:permissionId — use SDK client
    const permMatch = req.path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)\/?$/);
    if (req.method === "POST" && permMatch) {
      const sessionId = permMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      const permissionId = permMatch[2];
      try {
        const result = await this.sdkClient.postSessionIdPermissionsPermissionId({
          path: { id: sessionId, permissionID: permissionId },
          body: req.body as any,
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK permissions() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK permissions(${sessionId}, ${permissionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error handling permission via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to handle permission: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // GET /session/status — use SDK client
    // IMPORTANT: Must appear BEFORE `GET /session/:id` — otherwise the regex
    // /^\/session\/([^/]+)\/?$/ matches "status" as a session ID.
    if (req.method === "GET" && (req.path === "/session/status" || req.path === "/session/status/")) {
      try {
        const result = await this.sdkClient.session.status();
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.status() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.status() → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error fetching session status via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to fetch session status: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // GET /session/:id — use SDK client, enrich with project name
    const sessionGetMatch = req.path.match(/^\/session\/([^/]+)\/?$/);
    if (req.method === "GET" && sessionGetMatch) {
      const sessionId = sessionGetMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.get({
          path: { id: sessionId },
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.get() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 500,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.get(${sessionId}) → success`);
        const body = data && typeof data === "object" && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>), project: this.projectName }
          : data;
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error fetching session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to fetch session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // PATCH /session/:id — use SDK client (update session properties)
    if (req.method === "PATCH" && sessionGetMatch) {
      const sessionId = sessionGetMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.update({
          path: { id: sessionId },
          body: req.body as any,
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.update() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.update(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error updating session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to update session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // DELETE /session/:id — use SDK client
    const sessionDeleteMatch = req.path.match(/^\/session\/([^/]+)\/?$/);
    if (req.method === "DELETE" && sessionDeleteMatch) {
      const sessionId = sessionDeleteMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.delete({
          path: { id: sessionId },
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.delete() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.delete(${sessionId}) → success`);
        // Remove from visible set so deleted sessions don't accumulate
        this.visibleSessionIds.delete(sessionId);
        saveVisibleSessions(this.visibleSessionIds).catch(() => {});
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error deleting session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to delete session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // POST /session/:id/revert — use SDK client
    const revertMatch = req.path.match(/^\/session\/([^/]+)\/revert\/?$/);
    if (req.method === "POST" && revertMatch) {
      const sessionId = revertMatch[1];
      if (rejectIfNotVisible(sessionId)) return;
      try {
        const result = await this.sdkClient.session.revert({
          path: { id: sessionId },
          body: req.body as any,
        });
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK session.revert() error:`, error);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: (error as any)?.name === "NotFoundError" ? 404 : 400,
            body: error,
          } satisfies HttpResponse);
          return;
        }
        debug(`[mast-relay] SDK session.revert(${sessionId}) → success`);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 200,
          body: data,
        } satisfies HttpResponse);
        return;
      } catch (err) {
        console.error(`[mast-relay] Error reverting session via SDK:`, err);
        this.send({
          type: "http_response",
          requestId: req.requestId,
          status: 502,
          body: { error: `Failed to revert session: ${err}` },
        } satisfies HttpResponse);
        return;
      }
    }

    // GET /mcp or GET /mcp-servers — use SDK client
    if (req.method === "GET" && (req.path === "/mcp-servers" || req.path === "/mcp")) {
      try {
        const result = await this.sdkClient.mcp.status();
        const { data, error } = result;
        if (error) {
          console.warn(`[mast-relay] SDK mcp.status() error:`, error);
          // Fall through to generic handler
        } else {
          // For /mcp-servers, wrap in the format the web client expects
          const body = req.path === "/mcp-servers"
            ? [{ project: this.projectName, servers: data }]
            : data;
          debug(`[mast-relay] SDK mcp.status() → success`);
          this.send({
            type: "http_response",
            requestId: req.requestId,
            status: 200,
            body,
          } satisfies HttpResponse);
          return;
        }
      } catch {
        // Fall through to generic handler
      }
    }

    // --- Generic fallback: forward to OpenCode via raw fetch using SDK base URL ---
    try {
      let url = `${this.openCodeBaseUrl}${req.path}`;
      if (req.query && Object.keys(req.query).length > 0) {
        const params = new URLSearchParams(req.query);
        url += `?${params.toString()}`;
      }

      const fetchOpts: RequestInit = { method: req.method };
      if (req.body !== undefined && req.method !== "GET" && req.method !== "HEAD") {
        fetchOpts.body = JSON.stringify(req.body);
        fetchOpts.headers = { "Content-Type": "application/json" };
      }

      const res = await fetch(url, fetchOpts);
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

      debug(`[mast-relay] → ${res.status} (generic forward to ${this.openCodeBaseUrl})`);
      this.send({
        type: "http_response",
        requestId: req.requestId,
        status: res.status,
        body,
      } satisfies HttpResponse);
    } catch (err) {
      console.error(`[mast-relay] Error forwarding ${req.method} ${req.path}:`, err);
      this.send({
        type: "http_response",
        requestId: req.requestId,
        status: 502,
        body: { error: String(err) },
      } satisfies HttpResponse);
    }
  }

  // ---------------------------------------------------------------------------
  // sync_request: fetch sessions + messages from OpenCode via SDK, return to orchestrator
  // ---------------------------------------------------------------------------
  private async handleSyncRequest(syncReq: SyncRequest): Promise<void> {
    debug(`[mast-relay] sync_request received (${syncReq.cachedSessionIds.length} cached session IDs)`);

    try {
      // Fetch current sessions from OpenCode via SDK
      const listResult = await this.sdkClient.session.list();
      const { data: sessionsData, error: listError } = listResult;
      if (listError || !sessionsData) {
        console.warn(`[mast-relay] sync: SDK session.list() error:`, listError);
        this.send({ type: "sync_response", sessions: [] } satisfies SyncResponse);
        return;
      }

      const sessions = Array.isArray(sessionsData) ? sessionsData : MiniRelay.extractArray(sessionsData);
      const syncSessions: SyncResponse["sessions"] = [];

      // For each cached session the orchestrator cares about, fetch messages
      // (only if the session is in our visible set)
      for (const sessionId of syncReq.cachedSessionIds) {
        if (!this.visibleSessionIds.has(sessionId)) continue;
        const sessionExists = sessions.some((s: any) => s.id === sessionId);
        if (!sessionExists) continue;

        try {
          const msgResult = await this.sdkClient.session.messages({
            path: { id: sessionId },
          });
          const { data: msgData, error: msgError } = msgResult;
          if (msgError || !msgData) {
            console.warn(`[mast-relay] sync: SDK session.messages(${sessionId}) error:`, msgError);
            continue;
          }

          const messages = Array.isArray(msgData) ? msgData : MiniRelay.extractArray(msgData);
          // Filter to messages after the lastEventTimestamp if provided
          const cutoff = syncReq.lastEventTimestamp
            ? new Date(syncReq.lastEventTimestamp).getTime()
            : 0;
          const filtered = messages.filter((m: any) => {
            // SDK returns { info: Message, parts: Part[] } objects
            const info = m.info ?? m;
            const created = info.time?.created ?? info.createdAt;
            if (!created) return true; // include if no timestamp
            const ts = typeof created === "number" ? created : new Date(created).getTime();
            return ts > cutoff;
          });

          if (filtered.length > 0) {
            syncSessions.push({
              sessionId,
              messages: filtered.map((m: any) => {
                const info = m.info ?? m;
                return {
                  id: info.id,
                  role: info.role ?? "assistant",
                  parts: m.parts ?? [],
                  createdAt: info.createdAt ?? new Date(info.time?.created ?? Date.now()).toISOString(),
                };
              }),
            });
          }
        } catch (err) {
          console.warn(`[mast-relay] sync: failed to fetch messages for ${sessionId}:`, err);
        }
      }

      debug(`[mast-relay] sync_response: ${syncSessions.length} sessions with missed messages`);
      this.send({ type: "sync_response", sessions: syncSessions } satisfies SyncResponse);
    } catch (err) {
      console.error(`[mast-relay] sync: error:`, err);
      this.send({ type: "sync_response", sessions: [] } satisfies SyncResponse);
    }
  }

  private async subscribeSse(): Promise<void> {
    this.sseAbort = new AbortController();
    debug(`[mast-relay] Subscribing to SSE via SDK client.event.subscribe()`);

    try {
      const { stream } = await this.sdkClient.event.subscribe({
        signal: this.sseAbort.signal,
        headers: {
          Accept: "text/event-stream",
          "Content-Type": null as any, // remove default application/json from GET request
        },
      });

      debug("[mast-relay] SSE stream connected via SDK");

      for await (const event of stream) {
        if (this.sseAbort?.signal.aborted) break;

        try {
          // SDK yields parsed Event objects (type + properties/data)
          const parsed = event as any;
          if (parsed?.type) {
            // Extract session ID from event to apply visibility filter.
            // OpenCode events carry sessionID in different locations depending
            // on event type:
            //   message.updated        → properties.info.sessionID
            //   message.part.updated   → properties.part.sessionID
            //   message.part.delta     → properties.sessionID or properties.part.sessionID
            //   session.status         → properties.sessionID
            //   permission.*           → properties.sessionID
            //   session.created/updated/deleted → properties.info.id (session's own ID)
            const eventSessionId =
              parsed.properties?.sessionID ??
              parsed.data?.sessionID ??
              parsed.properties?.sessionId ??
              parsed.data?.sessionId ??
              parsed.properties?.info?.sessionID ??
              parsed.data?.info?.sessionID ??
              parsed.properties?.part?.sessionID ??
              parsed.data?.part?.sessionID ??
              parsed.properties?.info?.id ??
              parsed.data?.info?.id ??
              null;

            // If the event is session-scoped and the session is NOT visible, skip it.
            if (eventSessionId && !this.visibleSessionIds.has(eventSessionId)) {
              continue;
            }

            const { type, properties, data, ...rest } = parsed;
            this.send({
              type: "event",
              event: { type, data: data ?? properties ?? rest },
              timestamp: new Date().toISOString(),
            } satisfies EventMessage);
          }
        } catch {
          // Skip unparseable events
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[mast-relay] SSE stream error:", err);
    }

    // Stream ended (normal close or error) — reconnect after a short delay
    // unless we were intentionally disconnected.
    if (this.shouldReconnect && !this.sseAbort?.signal.aborted) {
      debug("[mast-relay] SSE stream ended, reconnecting in 2s...");
      setTimeout(() => this.subscribeSse(), 2000);
    }
  }

  send(msg: HttpResponse | EventMessage | DaemonStatus | Heartbeat | SyncResponse): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.sseAbort?.abort();
    this.sseAbort = null;
    this.ws = null;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    const jitter = Math.random() * 1000;
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() will call scheduleReconnect via onclose
      }
    }, delay + jitter);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// =============================================================================
// Plugin state
// =============================================================================

type PluginState = "idle" | "pairing" | "connected";

let state: PluginState = "idle";
let relay: MiniRelay | null = null;
/**
 * Set of session IDs visible to the remote client. Persisted to
 * ~/.mast/visible-sessions.json so it survives OpenCode restarts.
 * Hydrated on plugin load, updated when /rc is invoked or sessions
 * are created/deleted from the phone.
 */
let visibleSessionIds = new Set<string>();

// =============================================================================
// Core handler — called by command hook or event fallback
// =============================================================================

async function handleRcCommand(
  args: string,
  sdkClient: SdkClient,
  projectName: string,
  projectDirectory: string,
  sessionId: string,
  log: (msg: string) => void,
): Promise<string> {
  const trimmedArgs = args.trim();

  // --- /rc stop — explicit disconnect ---
  if (trimmedArgs === "stop") {
    if (relay) {
      await relay.disconnect();
      relay = null;
      state = "idle";
      return "Mast remote control has been disconnected.";
    }
    return "Mast remote control is not active.";
  }

  // --- /rc (no args) when connected — toggle off ---
  if (!trimmedArgs && state === "connected") {
    if (relay) {
      await relay.disconnect();
      relay = null;
    }
    state = "idle";
    return "Mast remote control has been disconnected.";
  }

  // --- /rc when pairing in progress ---
  if (state === "pairing") {
    return "Pairing is in progress. Check your browser to approve the connection.";
  }

  // --- Disconnect any existing relay before (re)connecting ---
  // Without this, running `/rc wss://...` while already connected creates a
  // NEW relay without tearing down the old one. The old relay's WebSocket + SSE
  // connections stay alive, causing duplicate event streams to the orchestrator.
  if (relay) {
    debug("[mast] Disconnecting existing relay before reconnect");
    await relay.disconnect();
    relay = null;
    state = "idle";
  }

  // --- Resolve orchestrator URL ---
  let orchestratorUrl: string | undefined;

  if (trimmedArgs && trimmedArgs.startsWith("ws")) {
    // /rc wss://... — user provided URL inline
    orchestratorUrl = trimmedArgs;
    await saveConfig({ orchestratorUrl });
    log("[mast] Saved orchestrator URL to ~/.mast/config.json");
  } else {
    // /rc (no args) — read from config
    const config = await loadConfig();
    orchestratorUrl = config.orchestratorUrl;
  }

  if (!orchestratorUrl) {
    return "No orchestrator URL configured. Use: /rc wss://your-orchestrator-url";
  }

  // --- Track this session as visible to the remote client ---
  if (sessionId) {
    visibleSessionIds.add(sessionId);
    await saveVisibleSessions(visibleSessionIds);
    debug(`[mast] Added session ${sessionId} to visible set (now ${visibleSessionIds.size})`);
  }

  // --- Resolve device key ---
  let deviceKey = await loadDeviceKey();

  if (!deviceKey) {
    // Need to pair — start background pairing flow
    state = "pairing";
    log("[mast] No device key found — starting pairing flow...");

    // Fire-and-forget: pairing runs in background
    runPairingFlow(orchestratorUrl, log)
      .then(async (key) => {
        await saveDeviceKey(key);
        log("[mast] Paired successfully! Connecting relay...");

        // Auto-connect after pairing
        try {
          relay = new MiniRelay(orchestratorUrl!, sdkClient, key, projectName, projectDirectory, visibleSessionIds);
          await relay.connect();
          state = "connected";
          log("[mast] Remote control is now active.");
        } catch (err) {
          state = "idle";
          log(`[mast] Failed to connect after pairing: ${err}`);
        }
      })
      .catch((err) => {
        state = "idle";
        log(`[mast] Pairing failed: ${err}`);
      });

    return "Pairing started. Approve the connection in your browser. Remote control will activate automatically once approved.";
  }

  // --- Connect relay ---
  try {
    relay = new MiniRelay(orchestratorUrl, sdkClient, deviceKey, projectName, projectDirectory, visibleSessionIds);
    await relay.connect();
    state = "connected";
    log("[mast] Remote control is now active.");
    return `Mast remote control is now active. Connected to ${orchestratorUrl}`;
  } catch (err) {
    state = "idle";
    relay = null;
    return `Failed to connect to orchestrator: ${err}`;
  }
}

// =============================================================================
// Plugin export
// =============================================================================

export const MastPlugin: Plugin = async ({ client, directory }) => {
  const projectName = basename(directory);
  const projectDirectory = directory;

  // Hydrate the visible session set from disk
  visibleSessionIds = await loadVisibleSessions();

  debug(`[mast] Plugin loaded — /rc available for remote control (project=${projectName}, ${visibleSessionIds.size} persisted sessions)`);

  const log = (msg: string) => {
    try {
      client.app.log({
        body: { service: "mast-plugin", level: "info", message: msg },
      });
    } catch {
      // Fallback: console.log if SDK logging fails
      console.log(msg);
    }
  };

  return {
    // Primary: intercept /rc command before execution
    "command.execute.before": async (input, output) => {
      if (input.command !== "rc") return;

      const result = await handleRcCommand(input.arguments, client, projectName, projectDirectory, input.sessionID, log);

      // Replace the template parts with our status message.
      // The model will still respond (OpenCode always sends commands to the
      // LLM), but the template in opencode.json instructs it to reply briefly.
      output.parts.length = 0;
      output.parts.push({ type: "text", text: result } as any);
    },

    // Fallback: if command.execute.before doesn't fire for custom commands,
    // this event handler will catch it. It can't modify output.parts, but
    // it logs the result via client.app.log().
    event: async ({ event }) => {
      // Only act if the command hook never fired (state would still be idle
      // after a /rc if the hook didn't run)
      if (
        event.type === "command.executed" &&
        (event as any).properties?.command === "rc" &&
        state === "idle" &&
        !relay
      ) {
        const args = (event as any).properties?.arguments ?? "";
        const eventSessionId = (event as any).properties?.sessionID ?? "";
        const result = await handleRcCommand(args, client, projectName, projectDirectory, eventSessionId, log);
        log(result);
      }
    },
  };
};
