import { Hono } from "hono";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import type { DaemonConnection } from "./daemon-connection.js";

export function createApp(daemonConnection: DaemonConnection): Hono {
  const app = new Hono();

  // --- Health (no auth) ---
  app.get("/health", (c) => {
    return c.json({ status: "ok", daemonConnected: daemonConnection.isConnected() });
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
      return await daemonConn.sendRequest(method, path, body, query);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[orchestrator] forward error: ${message}`);
      return { status: 502, body: { error: message } };
    }
  }

  // --- Session routes ---

  // List sessions
  app.get("/sessions", async (c) => {
    const result = await forward(daemonConnection, "GET", "/session");
    return c.json(result.body as object, result.status as 200);
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
    return c.json(result.body as object, result.status as 200);
  });

  // Get session
  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const result = await forward(daemonConnection, "GET", `/session/${id}`);
    return c.json(result.body as object, result.status as 200);
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
    const result = await forward(daemonConnection, "POST", `/session/${id}/prompt_async`, body);
    return c.json(result.body as object, result.status as 200);
  });

  // List messages
  app.get("/sessions/:id/messages", async (c) => {
    const id = c.req.param("id");
    const result = await forward(daemonConnection, "GET", `/session/${id}/message`);
    return c.json(result.body as object, result.status as 200);
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

  return app;
}
