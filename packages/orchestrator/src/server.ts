import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { HARDCODED_DEVICE_KEY } from "@mast/shared";
import { DaemonConnection } from "./daemon-connection.js";
import { createApp } from "./routes.js";

export interface ServerHandle {
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  daemonConnection: DaemonConnection;
  port: number;
  close: () => Promise<void>;
}

export function startServer(port: number): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const daemonConnection = new DaemonConnection();
    const app = createApp(daemonConnection);

    const requestListener = getRequestListener(app.fetch);
    const server = createServer(requestListener);

    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const parsed = parseUrl(request.url ?? "", true);

      if (parsed.pathname !== "/daemon") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

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
    });

    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Mast orchestrator listening on port ${actualPort}`);

      resolve({
        server,
        wss,
        daemonConnection,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => {
              server.close(() => res());
            });
          }),
      });
    });
  });
}
