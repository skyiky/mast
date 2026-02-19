import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { HARDCODED_DEVICE_KEY, HARDCODED_API_TOKEN, type EventMessage } from "@mast/shared";
import { DaemonConnection } from "./daemon-connection.js";
import { PhoneConnectionManager } from "./phone-connections.js";
import { createApp } from "./routes.js";
import type { SessionStore } from "./session-store.js";
import type { PushNotifier } from "./push-notifications.js";

export interface ServerConfig {
  store?: SessionStore;
  pushNotifier?: PushNotifier;
}

export interface ServerHandle {
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  phoneWss: WebSocketServer;
  daemonConnection: DaemonConnection;
  phoneConnections: PhoneConnectionManager;
  port: number;
  close: () => Promise<void>;
}

export function startServer(
  port: number,
  config?: ServerConfig,
): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const daemonConnection = new DaemonConnection();
    const phoneConnections = new PhoneConnectionManager();
    const store = config?.store;
    const pushNotifier = config?.pushNotifier;

    const app = createApp({ daemonConnection, phoneConnections, store });

    // Wire daemon events to phone clients + cache + push
    daemonConnection.onEvent = (event: EventMessage) => {
      // 1. Forward to phone clients (sync, immediate)
      phoneConnections.broadcast(event);

      // 2. Cache in session store (async, fire-and-forget)
      if (store) {
        cacheEvent(store, event).catch((err) => {
          console.error("[orchestrator] cache error:", err);
        });
      }

      // 3. Push notification decision (async, fire-and-forget)
      if (pushNotifier) {
        pushNotifier
          .handleEvent({
            type: event.event.type,
            properties: event.event.data as Record<string, unknown> | undefined,
          })
          .catch((err) => {
            console.error("[orchestrator] push error:", err);
          });
      }
    };

    const requestListener = getRequestListener(app.fetch);
    const server = createServer(requestListener);

    // WSS for daemon connections
    const wss = new WebSocketServer({ noServer: true });

    // WSS for phone connections
    const phoneWss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const parsed = parseUrl(request.url ?? "", true);

      // --- Daemon upgrade: /daemon?token=<device_key> ---
      if (parsed.pathname === "/daemon") {
        const token = parsed.query.token;
        if (token !== HARDCODED_DEVICE_KEY) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws: WsWebSocket) => {
          daemonConnection.setConnection(ws);

          // Cancel pending daemon-offline push notification
          if (pushNotifier) {
            pushNotifier.handleDaemonReconnect();
          }

          ws.on("message", (data) => {
            try {
              daemonConnection.handleMessage(data.toString());
            } catch (err) {
              console.error("[orchestrator] error handling daemon message:", err);
            }
          });

          ws.on("close", () => {
            daemonConnection.clearConnection();
            // Schedule deferred daemon-offline push
            if (pushNotifier) {
              pushNotifier.handleDaemonDisconnect();
            }
          });

          ws.on("error", (err) => {
            console.error("[orchestrator] daemon ws error:", err);
            daemonConnection.clearConnection();
            if (pushNotifier) {
              pushNotifier.handleDaemonDisconnect();
            }
          });
        });
        return;
      }

      // --- Phone upgrade: /ws?token=<api_token> ---
      if (parsed.pathname === "/ws") {
        const token = parsed.query.token;
        if (token !== HARDCODED_API_TOKEN) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        phoneWss.handleUpgrade(request, socket, head, (ws: WsWebSocket) => {
          phoneConnections.add(ws);

          ws.on("close", () => {
            phoneConnections.remove(ws);
          });

          ws.on("error", (err) => {
            console.error("[orchestrator] phone ws error:", err);
            phoneConnections.remove(ws);
          });
        });
        return;
      }

      // Unknown upgrade path
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    });

    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Mast orchestrator listening on port ${actualPort}`);

      resolve({
        server,
        wss,
        phoneWss,
        daemonConnection,
        phoneConnections,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            phoneConnections.closeAll();
            phoneWss.close(() => {
              wss.close(() => {
                server.close(() => res());
              });
            });
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Event caching helpers
// ---------------------------------------------------------------------------

async function cacheEvent(
  store: SessionStore,
  event: EventMessage,
): Promise<void> {
  const data = event.event.data as Record<string, unknown> | undefined;
  if (!data) return;

  const sessionId = data.sessionID as string | undefined;

  switch (event.event.type) {
    case "message.created": {
      const msg = data.message as
        | { id: string; role: string }
        | undefined;
      if (msg && sessionId) {
        await store.upsertSession({ id: sessionId });
        await store.addMessage({
          id: msg.id,
          sessionId,
          role: msg.role,
          parts: [],
        });
      }
      break;
    }

    case "message.part.created":
    case "message.part.updated": {
      const messageId = data.messageID as string | undefined;
      const part = data.part as { type: string; content?: string } | undefined;
      if (messageId && part) {
        await store.updateMessageParts(messageId, [part]);
      }
      break;
    }

    case "message.completed": {
      const messageId = data.messageID as string | undefined;
      if (messageId) {
        await store.markMessageComplete(messageId);
      }
      break;
    }
  }
}
