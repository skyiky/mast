# AGENTS.md — Codebase Context for AI Agents

This file provides context for AI coding agents working on the Mast codebase. Read this before making changes.

## What Mast Does

Mast is a mobile-first async interface for directing AI coding agents. A phone app talks to an orchestrator server, which relays to a daemon on the developer's machine, which controls an OpenCode agent process. The phone user can chat with the agent, approve permission requests, review diffs, and ship code — all from their phone.

The system is async, not real-time. The developer plans with the agent (sync), the agent executes (async, phone in pocket), and the developer reviews and approves (sync).

## Architecture Overview

```
Phone (Expo) ──WSS──> Orchestrator (Azure) <──WSS── Daemon (dev machine)
                                                          │
                                                     HTTP + SSE
                                                          │
                                                      OpenCode
                                                    (localhost:4096)
```

All connections are outbound. Neither the phone nor the dev machine expose inbound ports. The orchestrator is the only publicly accessible component.

## Monorepo Layout

This is an npm workspaces monorepo. All packages are under `packages/`.

```
mast/
├── package.json                    # Workspace root: "workspaces": ["packages/*"]
├── tsconfig.base.json              # Shared TS config (ES2022, Node16)
├── Dockerfile                      # Azure Container Apps deployment (orchestrator only)
├── supabase/migrations/
│   └── 001_initial_schema.sql      # sessions, messages, push_tokens tables
├── docs/plans/                     # Phase plans and test plans (historical)
│
├── packages/shared/                # @mast/shared
│   └── src/protocol.ts             # All WSS message types, constants, helpers
│
├── packages/orchestrator/          # @mast/orchestrator
│   ├── src/
│   │   ├── index.ts                # Entry point — wires store, push, pairing, server
│   │   ├── server.ts               # HTTP (Hono) + WSS server setup
│   │   ├── routes.ts               # API routes: /health, /sessions/*, /push/register, /pair/verify
│   │   ├── daemon-connection.ts    # Daemon WSS state, request correlation, timeouts
│   │   ├── phone-connections.ts    # Phone WSS connection pool, broadcast
│   │   ├── session-store.ts        # SessionStore interface + InMemorySessionStore
│   │   ├── supabase-store.ts       # SupabaseSessionStore (production persistence)
│   │   ├── pairing.ts              # PairingManager — code generation, verification, expiry
│   │   ├── sync.ts                 # buildSyncRequest / processSyncResponse for reconnection
│   │   └── push-notifications.ts   # PushNotifier + PushDeduplicator (Expo push API)
│   └── test/
│       ├── helpers.ts              # startTestServer, connectDaemon, connectPhone helpers
│       ├── fake-opencode.ts        # Mock OpenCode HTTP + SSE server
│       ├── fake-expo-push.ts       # Mock Expo push notification server
│       ├── integration.test.ts     # Phase 1: relay chain (19 tests)
│       ├── streaming.test.ts       # Phase 2: SSE event streaming (9 tests)
│       ├── permissions.test.ts     # Phase 3: permission approval flow (9 tests)
│       ├── cache.test.ts           # Phase 3: session cache (6 tests)
│       ├── push.test.ts            # Phase 3: push notifications (7 tests)
│       ├── unit.test.ts            # Phases 1-4: unit tests (23 tests)
│       ├── pairing.test.ts         # Phase 4: pairing flow (8 tests)
│       ├── health.test.ts          # Phase 4: health monitoring (6 tests)
│       ├── timing.test.ts          # Phase 4: reconnect backoff (5 tests)
│       └── reconnect.test.ts       # Phase 4: reconnection + cache sync (10 tests)
│
├── packages/daemon/                # @mast/daemon
│   ├── src/
│   │   ├── index.ts                # Entry point — OpenCode start, pairing, relay, health
│   │   ├── relay.ts                # WSS client, HTTP relay to OpenCode, reconnection
│   │   ├── sse-client.ts           # SSE subscription to OpenCode /event stream
│   │   ├── health-monitor.ts       # Periodic /global/health checks, state machine
│   │   ├── opencode-process.ts     # Child process management for `opencode serve`
│   │   └── key-store.ts            # Device key persistence (~/.mast/device-key.json)
│   └── test/
│       ├── key-store.test.ts       # KeyStore CRUD + permissions (10 tests)
│       └── process.test.ts         # OpenCodeProcess start/stop/restart/crash (5 tests)
│
└── packages/mobile/                # @mast/mobile
    ├── app.json                    # Expo config (scheme: "mast")
    ├── babel.config.js             # NativeWind JSX import source
    ├── metro.config.js             # withNativeWind(config, { input: "./global.css" })
    ├── tailwind.config.js          # nativewind/preset, custom "mast" color palette
    ├── global.css                  # Tailwind directives
    ├── app/                        # Expo Router file-based routing
    │   ├── _layout.tsx             # Root stack, dark mode, push notification setup
    │   ├── index.tsx               # Session list, pull-to-refresh, FAB
    │   ├── chat/[id].tsx           # Chat screen, streaming messages, send input
    │   ├── pair.tsx                # QR scanner (expo-camera) + manual code entry
    │   └── settings.tsx            # Connection status, verbosity, theme, re-pair
    └── src/
        ├── stores/
        │   ├── connection.ts       # Zustand: serverUrl, apiToken, wsConnected, etc. (persisted)
        │   ├── settings.ts         # Zustand: verbosity, colorScheme (persisted)
        │   └── sessions.ts         # Zustand: sessions, messages, permissions (not persisted)
        ├── hooks/
        │   ├── useWebSocket.ts     # WSS connection, event dispatch into Zustand stores
        │   ├── useApi.ts           # Thin hook wrapper for API client
        │   └── usePushNotifications.ts  # Token registration, notification tap handling
        ├── lib/
        │   └── api.ts              # Non-hook API client (fetch-based, typed)
        └── components/
            ├── MessageBubble.tsx    # User/assistant message rendering
            ├── MarkdownContent.tsx  # EnrichedMarkdownText wrapper with dark mode
            ├── ToolCallCard.tsx     # Collapsible tool invocation card
            ├── PermissionCard.tsx   # Approve/deny permission UI
            ├── ConnectionBanner.tsx # Top banner for degraded connection states
            ├── SessionRow.tsx       # Session list row with preview + timestamp
            └── CodeInput.tsx        # 6-digit pairing code input with auto-advance
```

## WSS Protocol

All communication between orchestrator and daemon uses JSON messages over a single WebSocket connection. Types are defined in `packages/shared/src/protocol.ts`.

### Orchestrator -> Daemon

| Type | Purpose |
|---|---|
| `http_request` | Relay an HTTP request (from phone API) to OpenCode |
| `heartbeat_ack` | Acknowledge daemon heartbeat |
| `sync_request` | After reconnect: request missed messages for cached sessions |
| `pair_response` | Result of pairing attempt (success + device key, or error) |

### Daemon -> Orchestrator

| Type | Purpose |
|---|---|
| `http_response` | Result of relayed HTTP request |
| `event` | SSE event from OpenCode (message.created, message.part.updated, etc.) |
| `status` | Daemon status update (opencodeReady boolean) |
| `heartbeat` | Periodic keepalive |
| `sync_response` | Missed messages for requested sessions |
| `pair_request` | Initiate pairing with a 6-digit code |

### Phone -> Orchestrator

Phone connects via WSS to `/ws?token=<apiToken>`. The orchestrator broadcasts `event` messages to all connected phones.

Phone uses HTTP REST for actions: `GET /sessions`, `POST /sessions/:id/prompt`, `POST /sessions/:id/approve/:pid`, etc.

## OpenCode API

The daemon relays to OpenCode running on `http://localhost:4096`. Key endpoints:

- `GET /session` — list sessions
- `POST /session` — create session
- `POST /session/:id/prompt_async` — send prompt (returns 204, no body)
- `GET /event` — SSE stream (message.created, message.part.updated, message.completed, permission.created, permission.updated)
- `POST /session/:id/permissions/:pid` — approve/deny `{ approve: boolean }`
- `GET /session/:id/diff` — get file diffs
- `GET /global/health` — health check

**Important:** `prompt_async` requires body format `{ "parts": [{ "type": "text", "text": "..." }] }` — NOT `{ "content": "..." }`.

**Important:** `prompt_async` returns HTTP 204 with an empty body. Do not try to JSON.parse the response.

## Key Patterns

### Authentication (Phase 1 hardcoded)

- Daemon connects to orchestrator WSS at `/daemon?token=<deviceKey>`
- Phone connects to orchestrator WSS at `/ws?token=<apiToken>`
- Phone REST requests use `Authorization: Bearer <apiToken>` header
- Hardcoded values in `@mast/shared`: `HARDCODED_DEVICE_KEY = "mast-dev-key-phase1"`, `HARDCODED_API_TOKEN = "mast-api-token-phase1"`
- After pairing, daemon gets a real device key (`dk_<uuid>`) stored in `~/.mast/device-key.json`

### Session Store Interface

`SessionStore` in `session-store.ts` defines the persistence interface:
- `addMessage(sessionId, message)` / `getMessages(sessionId)` / `listSessions()`
- `updateMessageParts(sessionId, messageId, parts)` / `markMessageComplete(sessionId, messageId)`
- `savePushToken(token)` / `getPushTokens()`

Two implementations: `InMemorySessionStore` (tests, local dev) and `SupabaseSessionStore` (production). The orchestrator chooses based on whether `SUPABASE_URL` env var is set.

### SSE Event Normalization

OpenCode SSE events use `{ type, properties: {...} }` but the shared protocol expects `{ type, data: {...} }`. The daemon's `sse-client.ts` normalizes this: `{ type, data: data ?? properties ?? rest }`.

### Supabase Writes Are Fire-and-Forget

On the streaming path, the orchestrator does NOT await DB writes before forwarding events to the phone WSS. This keeps latency low. Writes happen in the background.

### Push Notification Deduplication

- `permission.created` — always send immediately
- `message.part.updated` — max once per 5 minutes (debounced)
- Daemon disconnect — 30-second grace period (reconnect cancels the notification)
- No push sent if a phone client is currently connected

### Reconnection and Sync

When daemon reconnects after a disconnect:
1. Orchestrator sends `sync_request` with `{ cachedSessionIds, lastEventTimestamp }`
2. Daemon queries OpenCode for each session's messages, filters by timestamp
3. Daemon sends `sync_response` with missed messages
4. Orchestrator backfills session store and broadcasts to connected phones

Daemon reconnection uses exponential backoff: 1s, 2s, 4s... capped at 30s, with jitter.

### Health Monitoring

`HealthMonitor` checks `GET /global/health` every 30 seconds. State machine:
- healthy -> degraded (1-2 consecutive failures)
- degraded -> down (3+ consecutive failures)
- down -> recovery (health check passes again)

On crash, `onCrash` callback fires. On recovery needed, orchestrator triggers `opencode.restart()`.

## Testing

Tests use `node:test` (built into Node.js 24+). No external test framework.

```bash
npm test                    # all 110 tests
npm test --workspace=packages/orchestrator   # 95 orchestrator tests
npm test --workspace=packages/daemon         # 15 daemon tests
```

Test infrastructure:
- `test/fake-opencode.ts` — mock OpenCode HTTP server + SSE stream
- `test/fake-expo-push.ts` — mock Expo push notification server
- `test/helpers.ts` — `startTestServer()`, `connectDaemon()`, `connectPhone()` helpers

All tests are self-contained: they start/stop their own servers on random ports.

## Mobile Tech Details

- **Routing:** Expo Router (file-based, under `app/`)
- **Styling:** NativeWind v4 (Tailwind CSS for React Native). Dark mode uses `colorScheme.set()` from `nativewind`, NOT CSS class-based `darkMode: "class"`.
- **State:** Zustand stores. `connection` and `settings` stores are persisted via AsyncStorage. `sessions` store is not persisted.
- **Markdown:** `react-native-enriched-markdown` — component is `EnrichedMarkdownText` (named export), props are `markdown` and `markdownStyle`.
- **Push:** `expo-notifications` with `expo-device` for registration. Requires EAS projectId for push tokens.
- **Haptics:** `expo-haptics` on permission approve/deny and send message.

## Environment Variables

### Orchestrator
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `SUPABASE_URL` | — | Supabase project URL (enables persistence) |
| `SUPABASE_ANON_KEY` | — | Supabase anonymous key |
| `EXPO_PUSH_URL` | `https://exp.host/--/api/v2/push/send` | Push notification endpoint |

### Daemon
| Var | Default | Purpose |
|---|---|---|
| `MAST_ORCHESTRATOR_URL` | `ws://localhost:3000` | Orchestrator WSS URL |
| `OPENCODE_PORT` | `4096` | OpenCode server port |
| `MAST_SKIP_OPENCODE` | — | Set to `1` to skip starting OpenCode |

## Database Schema

Defined in `supabase/migrations/001_initial_schema.sql`:

- **sessions** — `id TEXT PK`, `title`, `status`, `created_at`, `updated_at`
- **messages** — `id TEXT PK`, `session_id FK`, `role`, `parts JSONB`, `streaming BOOLEAN`, `created_at`
- **push_tokens** — `token TEXT PK`, `created_at`

No row-level security (single-user MVP).

## Common Pitfalls

1. **Empty response bodies** — `prompt_async` returns HTTP 204 with no body. Guard against `JSON.parse("")`.
2. **SSE `properties` vs `data`** — OpenCode SSE events have a `properties` field, not `data`. The daemon normalizes this.
3. **NativeWind dark mode** — do NOT add `darkMode: "class"` to tailwind.config.js. NativeWind handles this internally.
4. **Expo Router entry** — `package.json` must have `"main": "expo-router/entry"`, not the default Expo entry.
5. **Prompt format** — OpenCode expects `{ "parts": [{ "type": "text", "text": "..." }] }`, not `{ "content": "..." }`.
6. **Module system** — all packages use ESM (`"type": "module"`). Imports must include `.js` extensions in TypeScript source files.
