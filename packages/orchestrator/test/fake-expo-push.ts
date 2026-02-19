/**
 * Fake Expo Push server for testing.
 *
 * Minimal HTTP server that records push notification payloads.
 * The orchestrator's push module sends to this instead of Expo's real API.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";

export interface PushNotification {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface FakeExpoPush {
  port: number;
  url: string;
  /** All push payloads received */
  notifications(): PushNotification[];
  /** Clear recorded notifications */
  reset(): void;
  close(): Promise<void>;
}

export function createFakeExpoPush(): Promise<FakeExpoPush> {
  return new Promise((resolve) => {
    const recorded: PushNotification[] = [];

    const server: Server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        // Only handle POST
        if (req.method !== "POST") {
          res.writeHead(404);
          res.end();
          return;
        }

        let bodyText = "";
        for await (const chunk of req) {
          bodyText += chunk;
        }

        try {
          const payloads = JSON.parse(bodyText);
          // Expo push API accepts an array of push payloads
          if (Array.isArray(payloads)) {
            for (const p of payloads) {
              recorded.push({
                to: p.to,
                title: p.title,
                body: p.body,
                data: p.data,
              });
            }
          }
        } catch {
          // ignore parse errors
        }

        // Respond with Expo-like success
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
      },
    );

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      resolve({
        port,
        url: `http://localhost:${port}`,
        notifications() {
          return [...recorded];
        },
        reset() {
          recorded.length = 0;
        },
        close() {
          server.closeAllConnections();
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
