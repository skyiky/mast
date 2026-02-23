import { Hono } from "hono";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import type { DaemonConnection } from "./daemon-connection.js";
import type { PhoneConnectionManager } from "./phone-connections.js";
import type { SessionStore } from "./session-store.js";
import type { PairingManager } from "./pairing.js";
import { verifyJwt, DEV_USER_ID } from "./auth.js";

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
}

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
    devMode = !jwtSecret,
  } = deps;

  const app = new Hono<{ Variables: Variables }>();

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

  // --- Auth middleware (skip /health) ---
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") {
      await next();
      return;
    }

    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = auth.slice(7); // strip "Bearer "

    // Dev mode: accept hardcoded API token
    if (devMode && token === HARDCODED_API_TOKEN) {
      c.set("userId", DEV_USER_ID);
      await next();
      return;
    }

    // JWT validation
    if (jwtSecret) {
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
      return c.json({ success: true, deviceKey: result.deviceKey }, 200);
    }
    return c.json({ success: false, error: result.error }, 400);
  });

  return app;
}
