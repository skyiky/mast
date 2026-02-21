import { Hono } from "hono";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import type { DaemonConnection } from "./daemon-connection.js";
import type { PhoneConnectionManager } from "./phone-connections.js";
import type { SessionStore } from "./session-store.js";
import type { PairingManager } from "./pairing.js";

export interface RouteDeps {
  daemonConnection: DaemonConnection;
  phoneConnections?: PhoneConnectionManager;
  store?: SessionStore;
  pairingManager?: PairingManager;
}

export function createApp(deps: RouteDeps): Hono {
  const { daemonConnection, phoneConnections, store, pairingManager } = deps;
  const app = new Hono();

  // --- Health (no auth) ---
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      daemonConnected: daemonConnection.isConnected(),
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
    if (auth !== `Bearer ${HARDCODED_API_TOKEN}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // --- Helper: check daemon is connected, forward request ---
  async function forward(
    daemonConn: DaemonConnection,
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ) {
    if (!daemonConn.isConnected()) {
      return { status: 503, body: { error: "Daemon not connected" } };
    }
    try {
      const result = await daemonConn.sendRequest(method, path, body, query);
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
    if (daemonConnection.isConnected()) {
      const result = await forward(daemonConnection, "GET", "/session");
      return c.json(result.body as object, result.status as 200);
    }
    // Daemon offline — serve from cache
    if (store) {
      const sessions = await store.listSessions();
      return c.json(sessions, 200);
    }
    return c.json({ error: "Daemon not connected" }, 503);
  });

  // Create session
  app.post("/sessions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemonConnection, "POST", "/session", body);
    // Cache the session
    if (store && result.status === 200 && result.body) {
      const session = result.body as { id: string };
      store.upsertSession({ id: session.id }).catch(() => {});
    }
    return c.json(result.body as object, result.status as 200);
  });

  // Get session
  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (daemonConnection.isConnected()) {
      const result = await forward(daemonConnection, "GET", `/session/${id}`);
      return c.json(result.body as object, result.status as 200);
    }
    if (store) {
      const session = await store.getSession(id);
      if (session) return c.json(session, 200);
    }
    return c.json({ error: "Daemon not connected" }, 503);
  });

  // Send message (sync)
  app.post("/sessions/:id/message", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemonConnection, "POST", `/session/${id}/message`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // Send prompt (async)
  app.post("/sessions/:id/prompt", async (c) => {
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
        .addMessage({
          id: userMsgId,
          sessionId: id,
          role: "user",
          parts,
        })
        .then(() => store.markMessageComplete(userMsgId))
        .catch(() => {});
    }
    const result = await forward(daemonConnection, "POST", `/session/${id}/prompt_async`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // List messages — try cache when daemon is offline
  app.get("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    if (daemonConnection.isConnected()) {
      const result = await forward(
        daemonConnection,
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
    const id = c.req.param("id");
    const result = await forward(daemonConnection, "GET", `/session/${id}/diff`);
    return c.json(result.body as object, result.status as 200);
  });

  // Abort session
  app.post("/sessions/:id/abort", async (c) => {
    const id = c.req.param("id");
    const result = await forward(daemonConnection, "POST", `/session/${id}/abort`);
    return c.json(result.body as object, result.status as 200);
  });

  // --- Provider / project info ---

  // List providers and models
  app.get("/providers", async (c) => {
    const result = await forward(daemonConnection, "GET", "/provider");
    return c.json(result.body as object, result.status as 200);
  });

  // Get current project info
  app.get("/project/current", async (c) => {
    const result = await forward(daemonConnection, "GET", "/project/current");
    return c.json(result.body as object, result.status as 200);
  });

  // Revert a message
  app.post("/sessions/:id/revert", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await forward(daemonConnection, "POST", `/session/${id}/revert`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // --- Permission routes (Phase 3) ---

  // Approve a permission
  app.post("/sessions/:id/approve/:pid", async (c) => {
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await forward(
      daemonConnection,
      "POST",
      `/session/${id}/permissions/${pid}`,
      { approve: true },
    );
    return c.json(result.body as object, result.status as 200);
  });

  // Deny a permission
  app.post("/sessions/:id/deny/:pid", async (c) => {
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await forward(
      daemonConnection,
      "POST",
      `/session/${id}/permissions/${pid}`,
      { approve: false },
    );
    return c.json(result.body as object, result.status as 200);
  });

  // --- Push notification routes (Phase 3) ---

  // Register a push token
  app.post("/push/register", async (c) => {
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
    await store.savePushToken(body.token);
    return c.json({ ok: true }, 200);
  });

  // --- Pairing routes (Phase 4) ---

  // Verify a pairing code (phone submits code → gets device key)
  app.post("/pair/verify", async (c) => {
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

    const result = pairingManager.verify(body.code);
    if (result.success) {
      return c.json({ success: true, deviceKey: result.deviceKey }, 200);
    }
    return c.json({ success: false, error: result.error }, 400);
  });

  return app;
}
