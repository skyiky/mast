import { Hono } from "hono";
import { HARDCODED_API_TOKEN, generateRequestId } from "@mast/shared";
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

  // --- Helper: send a semantic command and return HTTP-shaped result ---
  async function sendCommand(
    daemonConn: DaemonConnection,
    command: Parameters<DaemonConnection["sendCommand"]>[0],
  ): Promise<{ status: number; body: unknown }> {
    if (!daemonConn.isConnected()) {
      return { status: 503, body: { error: "Daemon not connected" } };
    }
    try {
      const result = await daemonConn.sendCommand(command);
      if (result.status === "ok") {
        return { status: 200, body: result.data ?? { ok: true } };
      }
      return { status: 500, body: { error: result.error ?? "Unknown error" } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[orchestrator] command error: ${message}`);
      return { status: 502, body: { error: message } };
    }
  }

  // --- Session routes ---

  // List sessions — try cache first when daemon is offline
  app.get("/sessions", async (c) => {
    if (daemonConnection.isConnected()) {
      const result = await sendCommand(daemonConnection, {
        type: "list_sessions",
        requestId: generateRequestId(),
      });
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
    let body: { agentType?: string } | undefined;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }
    const result = await sendCommand(daemonConnection, {
      type: "create_session",
      requestId: generateRequestId(),
      agentType: body?.agentType,
    });
    // Cache the session
    if (store && result.status === 200 && result.body) {
      const session = result.body as { id: string };
      store.upsertSession({ id: session.id }).catch(() => {});
    }
    return c.json(result.body as object, result.status as 200);
  });

  // Get session (still served from cache or via list_sessions — no dedicated command)
  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (store) {
      const session = await store.getSession(id);
      if (session) return c.json(session, 200);
    }
    // Fall back to listing all sessions and filtering
    if (daemonConnection.isConnected()) {
      const result = await sendCommand(daemonConnection, {
        type: "list_sessions",
        requestId: generateRequestId(),
      });
      if (result.status === 200 && Array.isArray(result.body)) {
        const session = (result.body as Array<{ id: string }>).find(
          (s) => s.id === id,
        );
        if (session) return c.json(session, 200);
      }
    }
    return c.json({ error: "Session not found" }, 404);
  });

  // Send prompt (async — fire-and-forget on daemon side)
  app.post("/sessions/:id/prompt", async (c) => {
    const id = c.req.param("id");
    let body: { parts?: Array<{ type: string; text: string }> } | undefined;
    try {
      body = await c.req.json();
    } catch {
      // no body is fine
    }

    // Extract text from the parts array
    const text =
      body?.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") ?? "";

    // Cache the user message
    if (store && text) {
      const parts = body?.parts ?? [];
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

    const result = await sendCommand(daemonConnection, {
      type: "send_prompt",
      requestId: generateRequestId(),
      sessionId: id,
      text,
    });
    return c.json(result.body as object, result.status as 200);
  });

  // List messages — try cache when daemon is offline
  app.get("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    if (daemonConnection.isConnected()) {
      const result = await sendCommand(daemonConnection, {
        type: "get_messages",
        requestId: generateRequestId(),
        sessionId: id,
      });
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
    const result = await sendCommand(daemonConnection, {
      type: "get_diff",
      requestId: generateRequestId(),
      sessionId: id,
    });
    return c.json(result.body as object, result.status as 200);
  });

  // Abort session
  app.post("/sessions/:id/abort", async (c) => {
    const id = c.req.param("id");
    const result = await sendCommand(daemonConnection, {
      type: "abort_session",
      requestId: generateRequestId(),
      sessionId: id,
    });
    return c.json(result.body as object, result.status as 200);
  });

  // --- Permission routes ---

  // Approve a permission
  app.post("/sessions/:id/approve/:pid", async (c) => {
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await sendCommand(daemonConnection, {
      type: "approve_permission",
      requestId: generateRequestId(),
      sessionId: id,
      permissionId: pid,
    });
    return c.json(result.body as object, result.status as 200);
  });

  // Deny a permission
  app.post("/sessions/:id/deny/:pid", async (c) => {
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const result = await sendCommand(daemonConnection, {
      type: "deny_permission",
      requestId: generateRequestId(),
      sessionId: id,
      permissionId: pid,
    });
    return c.json(result.body as object, result.status as 200);
  });

  // --- Push notification routes ---

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

  // --- Pairing routes ---

  // Verify a pairing code (phone submits code -> gets device key)
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
