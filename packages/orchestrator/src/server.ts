import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { HARDCODED_DEVICE_KEY, HARDCODED_API_TOKEN } from "@mast/shared";
import { DaemonConnection } from "./daemon-connection.js";
import { PhoneConnectionManager } from "./phone-connections.js";
import { createApp } from "./routes.js";

export interface ServerHandle {
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  phoneWss: WebSocketServer;
  daemonConnection: DaemonConnection;
  phoneConnections: PhoneConnectionManager;
  port: number;
  close: () => Promise<void>;
}

export function startServer(port: number): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const daemonConnection = new DaemonConnection();
    const phoneConnections = new PhoneConnectionManager();
    const app = createApp(daemonConnection, phoneConnections);

    // Wire daemon events to phone clients
    daemonConnection.onEvent = (event) => {
      phoneConnections.broadcast(event);
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

          ws.on("message", (data) => {
            try {
              daemonConnection.handleMessage(data.toString());
            } catch (err) {
              console.error("[orchestrator] error handling daemon message:", err);
            }
          });

          ws.on("close", () => {
            daemonConnection.clearConnection();
          });

          ws.on("error", (err) => {
            console.error("[orchestrator] daemon ws error:", err);
            daemonConnection.clearConnection();
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
