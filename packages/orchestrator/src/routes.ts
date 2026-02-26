import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import type { DaemonConnection } from "./daemon-connection.js";
import type { PhoneConnectionManager } from "./phone-connections.js";
import type { SessionStore } from "./session-store.js";
import type { PairingManager } from "./pairing.js";
import { verifyJwt, hasJwks, DEV_USER_ID } from "./auth.js";

// ---------------------------------------------------------------------------
// Hono variable typing
// ---------------------------------------------------------------------------

type Variables = {
  userId: string;
};

// ---------------------------------------------------------------------------
// Route dependencies
// ---------------------------------------------------------------------------

export interface RouteDeps {
  /** Per-user daemon connections: userId → DaemonConnection */
  daemonConnections: Map<string, DaemonConnection>;
  phoneConnections?: PhoneConnectionManager;
  store?: SessionStore;
  pairingManager?: PairingManager;
  /** Supabase JWT secret for verifying Bearer tokens */
  jwtSecret?: string;
  /** Accept hardcoded Phase 1 tokens (auto-enabled when jwtSecret is absent) */
  devMode?: boolean;
  /** Supabase store — used to persist device keys on pairing */
  supabaseStore?: import("./supabase-store.js").SupabaseSessionStore;
  /** Path to built web client dist directory for static file serving */
  webDistPath?: string;
}

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(deps: RouteDeps): Hono<{ Variables: Variables }> {
  const {
    daemonConnections,
    phoneConnections,
    store,
    pairingManager,
    jwtSecret,
    devMode = !jwtSecret && !hasJwks(),
    supabaseStore,
    webDistPath,
  } = deps;

  const app = new Hono<{ Variables: Variables }>();

  // --- Static file middleware (before auth) ---
  // Serves real files from webDistPath. Must run before auth so static assets
  // don't require a Bearer token.
  if (webDistPath) {
    app.use("*", async (c, next) => {
      // Skip known API paths — let them fall through to auth + API routes
      const reqPath = c.req.path;
      if (
        reqPath === "/health" ||
        reqPath.startsWith("/sessions") ||
        reqPath.startsWith("/pair") ||
        reqPath.startsWith("/push") ||
        reqPath.startsWith("/providers") ||
        reqPath.startsWith("/projects") ||
        reqPath.startsWith("/project") ||
        reqPath.startsWith("/mcp-servers") ||
        reqPath === "/daemon" ||
        reqPath === "/ws"
      ) {
        await next();
        return;
      }

      // Serve index.html for the root path
      if (reqPath === "/") {
        const indexPath = join(webDistPath, "index.html");
        if (existsSync(indexPath)) {
          const content = readFileSync(indexPath);
          return c.body(content, 200, {
            "Content-Type": "text/html",
          });
        }
      }

      // Try to serve a real file from the dist directory
      const filePath = resolve(join(webDistPath, reqPath));
      // Path traversal protection: ensure resolved path stays within webDistPath
      const resolvedBase = resolve(webDistPath);
      if (!filePath.startsWith(resolvedBase)) {
        await next();
        return;
      }
      if (existsSync(filePath) && !filePath.endsWith("/")) {
        const ext = extname(filePath);
        if (ext && MIME_TYPES[ext]) {
          const content = readFileSync(filePath);
          return c.body(content, 200, {
            "Content-Type": MIME_TYPES[ext],
          });
        }
      }

      await next();
    });
  }

  // --- Health (no auth) ---
  app.get("/health", (c) => {
    // Sum daemon connections across all users
    let daemonCount = 0;
    for (const d of daemonConnections.values()) {
      if (d.isConnected()) daemonCount++;
    }
    return c.json({
      status: "ok",
      daemonConnected: daemonCount > 0,
      phonesConnected: phoneConnections?.count() ?? 0,
    });
  });

  // --- Auth middleware (skip /health and non-API paths) ---
  app.use("*", async (c, next) => {
    const reqPath = c.req.path;

    // Skip auth for health endpoint
    if (reqPath === "/health") {
      await next();
      return;
    }

    // Determine if this is a known API path that requires authentication
    const isApiPath =
      reqPath.startsWith("/sessions") ||
      reqPath.startsWith("/pair") ||
      reqPath.startsWith("/push") ||
      reqPath.startsWith("/providers") ||
      reqPath.startsWith("/projects") ||
      reqPath.startsWith("/project") ||
      reqPath.startsWith("/mcp-servers");

    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      // When serving static files, unauthenticated GET requests should get the
      // SPA fallback (index.html) instead of 401. This allows browser navigation
      // to work (e.g., /sessions/abc loads the React SPA). Non-GET requests
      // (API calls) still get 401 so errors are caught properly.
      if (webDistPath && c.req.method === "GET") {
        const indexPath = join(webDistPath, "index.html");
        if (existsSync(indexPath)) {
          const content = readFileSync(indexPath);
          return c.body(content, 200, {
            "Content-Type": "text/html",
          });
        }
      }
      // Non-API paths without auth and without webDistPath → let the catch-all handle it
      if (!isApiPath) {
        await next();
        return;
      }
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = auth.slice(7); // strip "Bearer "

    // Dev mode: accept hardcoded API token
    if (devMode && token === HARDCODED_API_TOKEN) {
      c.set("userId", DEV_USER_ID);
      await next();
      return;
    }

    // JWT validation (ES256 via JWKS, or HS256 via secret)
    if (hasJwks() || jwtSecret) {
      try {
        const payload = verifyJwt(token, jwtSecret);
        c.set("userId", payload.sub);
        await next();
        return;
      } catch (err) {
        console.error("[orchestrator] JWT verification failed:", err);
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    // No jwtSecret and not a valid dev token
    return c.json({ error: "Unauthorized" }, 401);
  });

  // --- Helper: get daemon for current user ---
  function getDaemon(userId: string): DaemonConnection | undefined {
    return daemonConnections.get(userId);
  }

  // --- Helper: check daemon is connected, forward request ---
  async function forward(
    daemon: DaemonConnection | undefined,
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ) {
    if (!daemon || !daemon.isConnected()) {
      return { status: 503, body: { error: "Daemon not connected" } };
    }
    try {
      const result = await daemon.sendRequest(method, path, body, query);
      // HTTP 204 (No Content) must not have a body — remap to 200 with { ok: true }
      // to avoid protocol errors from reverse proxies (e.g., Azure Envoy).
      if (result.status === 204) {
        return { status: 200, body: { ok: true } };
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[orchestrator] forward error: ${message}`);
      return { status: 502, body: { error: message } };
    }
  }

  // --- Session routes ---

  // List sessions — try cache first when daemon is offline
  app.get("/sessions", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);

    if (daemon?.isConnected()) {
      const result = await forward(daemon, "GET", "/session");
      // Side-effect: cache session metadata (titles) for offline fallback
      if (store && result.status === 200 && Array.isArray(result.body)) {
        for (const s of result.body as Array<Record<string, unknown>>) {
          store.upsertSession(userId, {
            id: s.id as string,
            title: (s.slug ?? s.title) as string | undefined,
          }).catch(() => {});
        }
      }
      return c.json(result.body as object, result.status as 200);
    }
    // Daemon offline — serve from cache
    if (store) {
      const sessions = await store.listSessions(userId);
      return c.json(sessions, 200);
    }
    return c.json({ error: "Daemon not connected" }, 503);
  });

  // Create session
  app.post("/sessions", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemon, "POST", "/session", body);
    // Cache the session
    if (store && result.status === 200 && result.body) {
      const session = result.body as { id: string; slug?: string; title?: string };
      store.upsertSession(userId, { id: session.id, title: session.slug ?? session.title }).catch(() => {});
    }
    return c.json(result.body as object, result.status as 200);
  });

  // Get session
  app.get("/sessions/:id", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");

    if (daemon?.isConnected()) {
      const result = await forward(daemon, "GET", `/session/${id}`);
      return c.json(result.body as object, result.status as 200);
    }
    if (store) {
      const session = await store.getSession(userId, id);
      if (session) return c.json(session, 200);
    }
    return c.json({ error: "Daemon not connected" }, 503);
  });

  // Send message (sync)
  app.post("/sessions/:id/message", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemon, "POST", `/session/${id}/message`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // Send prompt (async)
  app.post("/sessions/:id/prompt", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    // Cache the user message
    if (store && body) {
      const parts = (body as { parts?: unknown[] }).parts ?? [];
      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      store
        .addMessage(userId, {
          id: userMsgId,
          sessionId: id,
          role: "user",
          parts,
        })
        .then(() => store.markMessageComplete(userMsgId))
        .catch(() => {});
    }
    const result = await forward(daemon, "POST", `/session/${id}/prompt_async`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // List messages — try cache when daemon is offline
  app.get("/sessions/:id/messages", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");

    if (daemon?.isConnected()) {
      const result = await forward(
        daemon,
        "GET",
        `/session/${id}/message`,
      );
      return c.json(result.body as object, result.status as 200);
    }
    // Daemon offline — serve from cache
    if (store) {
      const messages = await store.getMessages(id);
      return c.json(messages, 200);
    }
    return c.json({ error: "Daemon not connected" }, 503);
  });

  // Get diff
  app.get("/sessions/:id/diff", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");
    const result = await forward(daemon, "GET", `/session/${id}/diff`);
    return c.json(result.body as object, result.status as 200);
  });

  // Abort session
  app.post("/sessions/:id/abort", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");
    const result = await forward(daemon, "POST", `/session/${id}/abort`);
    return c.json(result.body as object, result.status as 200);
  });

  // --- MCP server routes ---

  // List MCP servers from all projects
  app.get("/mcp-servers", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const result = await forward(daemon, "GET", "/mcp-servers");
    return c.json(result.body as object, result.status as 200);
  });

  // --- Project management routes ---

  // List managed projects
  app.get("/projects", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const result = await forward(daemon, "GET", "/project");
    return c.json(result.body as object, result.status as 200);
  });

  // Add a new project
  app.post("/projects", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }
    const result = await forward(daemon, "POST", "/project", body);
    return c.json(result.body as object, result.status as 200);
  });

  // Remove a project
  app.delete("/projects/:name", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const name = c.req.param("name");
    const result = await forward(daemon, "DELETE", `/project/${encodeURIComponent(name)}`);
    return c.json(result.body as object, result.status as 200);
  });

  // --- Provider / project info ---

  // List providers and models
  app.get("/providers", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const result = await forward(daemon, "GET", "/provider");
    return c.json(result.body as object, result.status as 200);
  });

  // Get current project info
  app.get("/project/current", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const result = await forward(daemon, "GET", "/project/current");
    return c.json(result.body as object, result.status as 200);
  });

  // Revert a message
  app.post("/sessions/:id/revert", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemon, "POST", `/session/${id}/revert`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // --- Permission routes (Phase 3) ---

  // Approve a permission
  app.post("/sessions/:id/approve/:pid", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await forward(
      daemon,
      "POST",
      `/session/${id}/permissions/${pid}`,
      { approve: true },
    );
    return c.json(result.body as object, result.status as 200);
  });

  // Deny a permission
  app.post("/sessions/:id/deny/:pid", async (c) => {
    const userId = c.get("userId");
    const daemon = getDaemon(userId);
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await forward(
      daemon,
      "POST",
      `/session/${id}/permissions/${pid}`,
      { approve: false },
    );
    return c.json(result.body as object, result.status as 200);
  });

  // --- Push notification routes (Phase 3) ---

  // Register a push token
  app.post("/push/register", async (c) => {
    const userId = c.get("userId");

    if (!store) {
      return c.json({ error: "Store not configured" }, 500);
    }
    let body: { token?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }
    if (!body.token) {
      return c.json({ error: "Missing token" }, 400);
    }
    await store.savePushToken(userId, body.token);
    return c.json({ ok: true }, 200);
  });

  // --- Pairing routes (Phase 4) ---

  // Get info about a pending pairing (confirmation page fetches this)
  app.get("/pair/pending", (c) => {
    if (!pairingManager) {
      return c.json({ error: "Pairing not configured" }, 500);
    }
    const code = c.req.query("code");
    if (!code) {
      return c.json({ error: "Missing code" }, 400);
    }
    const pending = pairingManager.getPending(code);
    if (!pending) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({
      hostname: pending.hostname ?? null,
      projects: pending.projects ?? [],
      createdAt: pending.createdAt,
    });
  });

  // Verify a pairing code (phone submits code → gets device key)
  app.post("/pair/verify", async (c) => {
    const userId = c.get("userId");

    if (!pairingManager) {
      return c.json({ error: "Pairing not configured" }, 500);
    }
    let body: { code?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid body" }, 400);
    }
    if (!body.code) {
      return c.json({ error: "Missing code" }, 400);
    }

    const result = pairingManager.verify(body.code, userId);
    if (result.success) {
      // Persist device key to Supabase so it survives orchestrator restarts
      if (supabaseStore) {
        supabaseStore.saveDeviceKey(result.deviceKey, userId).catch((err) => {
          console.error("[orchestrator] failed to persist device key:", err);
        });
      }
      return c.json({ success: true, deviceKey: result.deviceKey }, 200);
    }
    return c.json({ success: false, error: result.error }, 400);
  });

  // --- Static file SPA fallback (after all API routes) ---
  // If no API route matched, serve index.html for paths without file extensions
  // (client-side routing). If webDistPath is not set, return 404.
  if (webDistPath) {
    app.all("*", (c) => {
      const indexPath = join(webDistPath, "index.html");
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        return c.body(content, 200, {
          "Content-Type": "text/html",
        });
      }
      return c.notFound();
    });
  } else {
    app.all("*", (c) => {
      return c.notFound();
    });
  }

  return app;
}
