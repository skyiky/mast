/**
 * Fake OpenCode HTTP server for testing.
 *
 * Provides a programmable HTTP server that impersonates OpenCode's API.
 * Tests register handlers per path, and the server responds accordingly.
 *
 * Phase 2 addition: SSE endpoint at GET /event.
 * Tests call pushEvent() to emit events to all connected SSE clients.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export interface FakeHandler {
  status: number;
  body: unknown;
  /** Optional delay in ms before responding */
  delay?: number;
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

export interface FakeOpenCode {
  port: number;
  baseUrl: string;
  server: Server;
  /** Register a handler for a given method + path */
  handle(method: string, path: string, handler: FakeHandler): void;
  /** Get recorded requests (method, path, body) */
  requests(): Array<{ method: string; path: string; body: unknown }>;
  /** Push an SSE event to all connected /event clients */
  pushEvent(event: SseEvent): void;
  /** Number of connected SSE clients */
  sseClientCount(): number;
  /** Set whether /global/health returns 200 or 503 */
  setHealthy(healthy: boolean): void;
  /** Clear all handlers and recorded requests */
  reset(): void;
  close(): Promise<void>;
}

export function createFakeOpenCode(): Promise<FakeOpenCode> {
  return new Promise((resolve) => {
    const handlers = new Map<string, FakeHandler>();
    const recorded: Array<{ method: string; path: string; body: unknown }> = [];
    const sseClients: Set<ServerResponse> = new Set();
    let healthy = true;

    function key(method: string, path: string): string {
      return `${method.toUpperCase()} ${path}`;
    }

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const method = (req.method ?? "GET").toUpperCase();
      const path = req.url ?? "/";

      // --- Health endpoint (toggleable) ---
      if (method === "GET" && path === "/global/health") {
        if (healthy) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error" }));
        }
        return;
      }

      // --- SSE endpoint ---
      if (method === "GET" && path === "/event") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        // Send initial comment to establish connection
        res.write(": connected\n\n");
        sseClients.add(res);

        req.on("close", () => {
          sseClients.delete(res);
        });
        // Don't end the response — keep it open for SSE
        return;
      }

      // --- Regular HTTP handlers ---
      // Read body
      let bodyText = "";
      for await (const chunk of req) {
        bodyText += chunk;
      }
      let body: unknown = null;
      if (bodyText.length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }

      recorded.push({ method, path, body });

      const handler = handlers.get(key(method, path));
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found", path }));
        return;
      }

      if (handler.delay) {
        await new Promise((r) => setTimeout(r, handler.delay));
      }

      if (handler.body === null || handler.body === undefined) {
        // Empty body response (like prompt_async 204)
        res.writeHead(handler.status);
        res.end();
      } else {
        res.writeHead(handler.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(handler.body));
      }
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      resolve({
        port,
        baseUrl: `http://localhost:${port}`,
        server,
        handle(method: string, path: string, handler: FakeHandler) {
          handlers.set(key(method, path), handler);
        },
        requests() {
          return [...recorded];
        },
        pushEvent(event: SseEvent) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          for (const client of sseClients) {
            client.write(data);
          }
        },
        sseClientCount() {
          return sseClients.size;
        },
        setHealthy(h: boolean) {
          healthy = h;
        },
        reset() {
          handlers.clear();
          recorded.length = 0;
          // Don't close SSE connections on reset — they persist
        },
        close() {
          // Close all SSE connections
          for (const client of sseClients) {
            client.end();
          }
          sseClients.clear();
          // Force close all keep-alive connections so server.close() doesn't hang
          server.closeAllConnections();
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
