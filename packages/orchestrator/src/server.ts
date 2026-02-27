import { createServer } from "node:http";
import { parse as parseUrl } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { HARDCODED_DEVICE_KEY, HARDCODED_API_TOKEN, type EventMessage, type PairRequest } from "@mast/shared";
import { DaemonConnection } from "./daemon-connection.js";
import { PhoneConnectionManager, type PhoneStatusMessage } from "./phone-connections.js";
import { createApp } from "./routes.js";
import type { SessionStore } from "./session-store.js";
import type { PushNotifier } from "./push-notifications.js";
import { PairingManager } from "./pairing.js";
import { EventTimestampTracker, buildSyncRequest, processSyncResponse } from "./sync.js";
import { verifyJwt, hasJwks, DEV_USER_ID } from "./auth.js";
import type { SupabaseSessionStore } from "./supabase-store.js";

export interface ServerConfig {
  store?: SessionStore;
  pushNotifier?: PushNotifier;
  pairingManager?: PairingManager;
  /** Supabase JWT secret for verifying phone/API tokens */
  jwtSecret?: string;
  /**
   * Dev mode: accept hardcoded Phase 1 tokens alongside JWTs.
   * Automatically enabled when jwtSecret is not provided.
   */
  devMode?: boolean;
  /** Supabase store for device key resolution (production only) */
  supabaseStore?: SupabaseSessionStore;
  /** Path to built web client dist directory for static file serving */
  webDistPath?: string;
}

export interface ServerHandle {
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  phoneWss: WebSocketServer;
  /** Per-user daemon connections: userId → DaemonConnection */
  daemonConnections: Map<string, DaemonConnection>;
  phoneConnections: PhoneConnectionManager;
  port: number;
  close: () => Promise<void>;
}

export function startServer(
  port: number,
  config?: ServerConfig,
): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const daemonConnections = new Map<string, DaemonConnection>();
    const phoneConnections = new PhoneConnectionManager();
    const store = config?.store;
    const pushNotifier = config?.pushNotifier;
    const pairingManager = config?.pairingManager ?? new PairingManager();
    const jwtSecret = config?.jwtSecret;
    const devMode = config?.devMode ?? (!jwtSecret && !hasJwks());
    const supabaseStore = config?.supabaseStore;
    const webDistPath = config?.webDistPath;

    /** Per-user event timestamp trackers */
    const timestampTrackers = new Map<string, EventTimestampTracker>();
    /** Per-user last opencodeReady state */
    const lastOpencodeReady = new Map<string, boolean>();

    function getTimestampTracker(userId: string): EventTimestampTracker {
      let tracker = timestampTrackers.get(userId);
      if (!tracker) {
        tracker = new EventTimestampTracker();
        timestampTrackers.set(userId, tracker);
      }
      return tracker;
    }

    /** Build a status snapshot for phones of a specific user */
    function buildPhoneStatus(userId: string): PhoneStatusMessage {
      const daemon = daemonConnections.get(userId);
      const status = {
        type: "status" as const,
        daemonConnected: daemon?.isConnected() ?? false,
        opencodeReady: lastOpencodeReady.get(userId) ?? false,
      };
      console.log(`[orchestrator] buildPhoneStatus user=${userId} daemon=${status.daemonConnected} opencode=${status.opencodeReady} hasDaemonEntry=${!!daemon} allDaemonKeys=[${[...daemonConnections.keys()].join(', ')}]`);
      return status;
    }

    /**
     * Get or create a DaemonConnection for a user, wiring up all callbacks
     * for event routing, sync, status, and push notifications.
     */
    function getOrCreateDaemon(userId: string): DaemonConnection {
      let daemon = daemonConnections.get(userId);
      if (daemon) return daemon;

      daemon = new DaemonConnection();
      daemonConnections.set(userId, daemon);

      // Wire daemon events to this user's phone clients + cache + push
      daemon.onEvent = (event: EventMessage) => {
        const tracker = getTimestampTracker(userId);
        tracker.update(event.timestamp);

        // 1. Forward to this user's phone clients (sync, immediate)
        phoneConnections.broadcast(userId, event);

        // 2. Cache in session store (async, fire-and-forget)
        if (store) {
          cacheEvent(store, userId, event).catch((err) => {
            console.error("[orchestrator] cache error:", err);
          });
        }

        // 3. Push notification decision (async, fire-and-forget)
        if (pushNotifier) {
          pushNotifier
            .handleEvent(userId, {
              type: event.event.type,
              properties: event.event.data as Record<string, unknown> | undefined,
            })
            .catch((err) => {
              console.error("[orchestrator] push error:", err);
            });
        }
      };

      // Wire sync_response handling
      daemon.onSyncResponse = (response) => {
        if (store) {
          processSyncResponse(response, store, userId, phoneConnections).catch((err) => {
            console.error("[orchestrator] sync response processing error:", err);
          });
        }
      };

      // Wire daemon status updates to this user's phone clients
      daemon.onStatus = (status) => {
        lastOpencodeReady.set(userId, status.opencodeReady);
        phoneConnections.broadcastStatus(userId, buildPhoneStatus(userId));
      };

      // Wire pair_request handling (extensibility hook)
      daemon.onPairRequest = (_request: PairRequest) => {
        // Pairing is managed in the WSS upgrade handler, not here.
      };

      return daemon;
    }

    const app = createApp({
      daemonConnections,
      phoneConnections,
      store,
      pairingManager,
      jwtSecret,
      devMode,
      supabaseStore,
      webDistPath,
    });

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
        const token = parsed.query.token as string | undefined;

        // Token resolution may require async Supabase lookup, so wrap
        // the entire handler in an async IIFE. The Node.js 'upgrade'
        // event doesn't await the return value.
        (async () => {
          // Resolve token to userId (or handle pairing)
          const isPairing = token === "pairing";
          let userId: string | undefined;

          if (isPairing) {
            // Pairing mode — handled separately below
          } else if (devMode && token === HARDCODED_DEVICE_KEY) {
            userId = DEV_USER_ID;
          } else if (token && pairingManager.isValidKey(token)) {
            userId = pairingManager.getUserIdForKey(token);
          } else if (token && supabaseStore) {
            // Async lookup: resolve device key from Supabase DB
            try {
              const resolved = await supabaseStore.resolveDeviceKey(token);
              if (resolved) {
                userId = resolved;
              }
            } catch (err) {
              console.error("[orchestrator] device key resolution error:", err);
            }
          }

          if (!isPairing && !userId) {
            console.warn(`[orchestrator] daemon auth failed — token not resolved (first 20 chars: ${token?.slice(0, 20)}…)`);
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          if (userId) {
            console.log(`[orchestrator] daemon resolved userId=${userId} via ${pairingManager.isValidKey(token!) ? 'pairingManager' : 'supabase'}`);
          }

          wss.handleUpgrade(request, socket, head, (ws: WsWebSocket) => {
          if (isPairing) {
            // Pairing mode — wait for pair_request, don't set as main daemon
            ws.on("message", (data) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.type === "pair_request") {
                  pairingManager.registerCode(msg.pairingCode, ws, {
                    hostname: msg.hostname,
                    projects: msg.projects,
                  });
                }
              } catch (err) {
                console.error("[orchestrator] pairing message error:", err);
              }
            });

            ws.on("close", () => {
              pairingManager.handleDaemonDisconnect(ws);
            });

            ws.on("error", () => {
              pairingManager.handleDaemonDisconnect(ws);
            });
            return;
          }

          // Normal authenticated daemon connection
          const daemon = getOrCreateDaemon(userId!);
          daemon.setConnection(ws);
          console.log(`[orchestrator] daemon connected as userId=${userId!} isConnected=${daemon.isConnected()} daemonConnections keys=[${[...daemonConnections.keys()].join(', ')}]`);

          // Update device key last_seen
          if (supabaseStore && token && token !== HARDCODED_DEVICE_KEY) {
            supabaseStore.touchDeviceKey(token).catch(() => {});
          }

          // Notify this user's phones that daemon is now connected
          phoneConnections.broadcastStatus(userId!, buildPhoneStatus(userId!));

          // Cancel pending daemon-offline push notification for this user
          if (pushNotifier) {
            pushNotifier.handleDaemonReconnect(userId!);
          }

          // Send sync_request if we have cached data
          if (store) {
            const tracker = getTimestampTracker(userId!);
            buildSyncRequest(store, userId!, tracker.get())
              .then((syncReq) => {
                daemon.sendRaw(syncReq);
              })
              .catch((err) => {
                console.error("[orchestrator] failed to build sync request:", err);
              });
          }

          ws.on("message", (data) => {
            try {
              daemon.handleMessage(data.toString());
            } catch (err) {
              console.error("[orchestrator] error handling daemon message:", err);
            }
          });

          ws.on("close", () => {
            daemon.clearConnection();
            lastOpencodeReady.set(userId!, false);
            // Notify this user's phones that daemon disconnected
            phoneConnections.broadcastStatus(userId!, buildPhoneStatus(userId!));
            // Schedule deferred daemon-offline push for this user
            if (pushNotifier) {
              pushNotifier.handleDaemonDisconnect(userId!);
            }
          });

          ws.on("error", (err) => {
            console.error("[orchestrator] daemon ws error:", err);
            daemon.clearConnection();
            lastOpencodeReady.set(userId!, false);
            phoneConnections.broadcastStatus(userId!, buildPhoneStatus(userId!));
            if (pushNotifier) {
              pushNotifier.handleDaemonDisconnect(userId!);
            }
          });
        });
        })().catch((err) => {
          console.error("[orchestrator] daemon upgrade error:", err);
          if (!socket.destroyed) {
            socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            socket.destroy();
          }
        });
        return;
      }

      // --- Phone upgrade: /ws?token=<jwt_or_api_token> ---
      if (parsed.pathname === "/ws") {
        const token = parsed.query.token as string | undefined;
        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        // Resolve token to userId
        let userId: string | undefined;

        if (devMode && token === HARDCODED_API_TOKEN) {
          userId = DEV_USER_ID;
        } else if (hasJwks() || jwtSecret) {
          try {
            const payload = verifyJwt(token, jwtSecret);
            userId = payload.sub;
          } catch (err) {
            console.error("[orchestrator] phone JWT verification failed:", err);
          }
        }

        if (!userId) {
          console.warn(`[orchestrator] phone auth failed — no userId resolved from token (first 20 chars: ${token?.slice(0, 20)}…)`);
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        phoneWss.handleUpgrade(request, socket, head, (ws: WsWebSocket) => {
          phoneConnections.add(userId!, ws);
          console.log(`[orchestrator] phone upgraded user=${userId!.slice(0, 8)}… count=${phoneConnections.countForUser(userId!)}`);

          // Send current daemon status immediately on connect
          const status = buildPhoneStatus(userId!);
          console.log(`[orchestrator] sending initial status to phone user=${userId!.slice(0, 8)}… status=${JSON.stringify(status)}`);
          phoneConnections.sendStatus(ws, status);

          ws.on("close", () => {
            phoneConnections.remove(userId!, ws);
            console.log(`[orchestrator] phone closed user=${userId!.slice(0, 8)}… remaining=${phoneConnections.countForUser(userId!)}`);
          });

          ws.on("error", (err) => {
            console.error("[orchestrator] phone ws error:", err);
            phoneConnections.remove(userId!, ws);
          });
        });
        return;
      }

      // Unknown upgrade path
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    });

    server.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Mast orchestrator listening on port ${actualPort}`);

      resolve({
        server,
        wss,
        phoneWss,
        daemonConnections,
        phoneConnections,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            phoneConnections.closeAll();
            // Terminate all daemon WSS clients (including pairing sockets)
            for (const client of wss.clients) {
              client.terminate();
            }
            for (const client of phoneWss.clients) {
              client.terminate();
            }
            phoneWss.close(() => {
              wss.close(() => {
                server.closeAllConnections();
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
  userId: string,
  event: EventMessage,
): Promise<void> {
  const data = event.event.data as Record<string, unknown> | undefined;
  if (!data) return;

  const sessionId = data.sessionID as string | undefined;

  switch (event.event.type) {
    // OpenCode sends message.updated for both new and updated messages.
    // The message info is at data.info (not data.message).
    case "message.updated": {
      const info = data.info as
        | { id: string; role: string; sessionID?: string; finish?: string; time?: { completed?: number } }
        | undefined;
      if (!info) break;
      const sid = info.sessionID ?? sessionId;
      if (!sid) break;

      if (info.finish || info.time?.completed) {
        // Message completed
        await store.markMessageComplete(info.id);
      } else {
        // New message
        await store.upsertSession(userId, { id: sid });
        await store.addMessage(userId, {
          id: info.id,
          sessionId: sid,
          role: info.role,
          parts: [],
        });
      }
      break;
    }

    // Legacy: keep message.created for backward compat with test fakes
    case "message.created": {
      const msg = data.message as
        | { id: string; role: string }
        | undefined;
      if (msg && sessionId) {
        await store.upsertSession(userId, { id: sessionId });
        await store.addMessage(userId, {
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
      // OpenCode shape: data.part = { id, messageID, sessionID, type, text }
      // Legacy shape:   data.messageID + data.part = { type, content }
      const part = data.part as
        | { id?: string; type: string; text?: string; content?: string; messageID?: string }
        | undefined;
      const messageId = (part?.messageID ?? data.messageID) as string | undefined;
      if (messageId && part) {
        // Skip non-renderable lifecycle parts — they carry no user-visible
        // content and would overwrite real text/tool parts in the store.
        if (part.type === "step-start" || part.type === "step-finish") break;
        // Normalize: OpenCode uses "text", legacy uses "content"
        const normalized = { ...part, content: part.text ?? part.content };
        await store.upsertMessagePart(messageId, normalized as Record<string, unknown>);
      }
      break;
    }

    // Session title/slug updates — OpenCode fires this after auto-titling
    case "session.updated":
    case "session.created": {
      const session = (data.info ?? data) as Record<string, unknown>;
      const id = (session.id ?? sessionId) as string | undefined;
      if (id) {
        const title = (session.slug ?? session.title) as string | undefined;
        await store.upsertSession(userId, { id, title });
      }
      break;
    }

    // Legacy — OpenCode signals completion via message.updated with finish
    case "message.completed": {
      const messageId = data.messageID as string | undefined;
      if (messageId) {
        await store.markMessageComplete(messageId);
      }
      break;
    }
  }
}
