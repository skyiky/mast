# Phase 1: Prove the Relay Works — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Daemon connects to orchestrator via WSS, relays HTTP requests to a local OpenCode server, returns responses. Tested via curl. No mobile app.

**Architecture:** Three npm packages in a monorepo — `@mast/shared` (protocol types), `@mast/orchestrator` (HTTP API + WSS server), `@mast/daemon` (WSS client + opencode serve lifecycle + relay). The orchestrator exposes an HTTP API. When a request arrives, it wraps it as a WSS message, sends it to the connected daemon, which relays it to the local OpenCode server and returns the response.

**Tech Stack:** Node.js 24, TypeScript, Hono (HTTP), ws (WebSocket), tsx (dev runner), vitest (tests), npm workspaces

---

## Project Structure

```
E:\dev\mast\
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   └── protocol.ts       # WSS message types
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── orchestrator/
│   │   ├── src/
│   │   │   ├── index.ts           # entry point
│   │   │   ├── server.ts          # HTTP + WSS server setup
│   │   │   ├── routes.ts          # Hono API routes
│   │   │   └── daemon-connection.ts  # daemon WSS state + request correlation
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── daemon/
│       ├── src/
│       │   ├── index.ts           # entry point
│       │   ├── opencode-process.ts  # manage opencode serve child process
│       │   └── relay.ts           # WSS client + request relay
│       ├── package.json
│       └── tsconfig.json
├── package.json                   # workspace root
└── tsconfig.base.json             # shared TS config
```

---

## Task 1: Scaffold Monorepo

**Files to create:**
- `package.json` (workspace root)
- `tsconfig.base.json`
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/orchestrator/package.json`
- `packages/orchestrator/tsconfig.json`
- `packages/daemon/package.json`
- `packages/daemon/tsconfig.json`

**Step 1: Create root package.json**

```json
{
  "name": "mast",
  "private": true,
  "workspaces": ["packages/*"]
}
```

**Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

**Step 3: Create package.json and tsconfig.json for each package**

shared/package.json:
```json
{
  "name": "@mast/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/protocol.ts",
  "types": "./src/protocol.ts"
}
```

orchestrator/package.json:
```json
{
  "name": "@mast/orchestrator",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx --watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@mast/shared": "*",
    "hono": "^4",
    "@hono/node-server": "^1",
    "ws": "^8"
  },
  "devDependencies": {
    "@types/ws": "^8",
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

daemon/package.json:
```json
{
  "name": "@mast/daemon",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx --watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@mast/shared": "*",
    "ws": "^8"
  },
  "devDependencies": {
    "@types/ws": "^8",
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

**Step 4: Run `npm install` from root**

**Step 5: Verify workspace setup**

Run: `npm ls --workspaces`
Expected: Shows all three packages

---

## Task 2: Shared Protocol Types

**File:** `packages/shared/src/protocol.ts`

Defines the WSS message protocol between orchestrator and daemon.

```typescript
// Messages from orchestrator to daemon
export interface HttpRequest {
  type: "http_request"
  requestId: string
  method: string
  path: string
  body?: unknown
  query?: Record<string, string>
}

// Messages from daemon to orchestrator
export interface HttpResponse {
  type: "http_response"
  requestId: string
  status: number
  body: unknown
}

export interface EventMessage {
  type: "event"
  event: {
    type: string
    data: unknown
  }
  timestamp: string
}

export interface DaemonStatus {
  type: "status"
  opencodeReady: boolean
  opencodeVersion?: string
}

export interface Heartbeat {
  type: "heartbeat"
  timestamp: string
}

export interface HeartbeatAck {
  type: "heartbeat_ack"
  timestamp: string
}

// Union types
export type OrchestratorMessage = HttpRequest | HeartbeatAck
export type DaemonMessage = HttpResponse | EventMessage | DaemonStatus | Heartbeat

// Auth
export const HARDCODED_DEVICE_KEY = "mast-dev-key-phase1"
export const HARDCODED_API_TOKEN = "mast-api-token-phase1"
```

---

## Task 3: Build Orchestrator

### 3a: Daemon Connection Manager

**File:** `packages/orchestrator/src/daemon-connection.ts`

Manages the WSS connection to the daemon. Handles request-response correlation.

Key logic:
- Stores the active daemon WebSocket
- `sendRequest(req)` sends an HttpRequest and returns a Promise<HttpResponse>
- Uses a Map<requestId, {resolve, reject, timeout}> for correlation
- Timeout after 120 seconds

### 3b: API Routes

**File:** `packages/orchestrator/src/routes.ts`

Hono routes:
- `GET /health` — health check
- `GET /sessions` — proxy to `GET /session` on OpenCode
- `POST /sessions` — proxy to `POST /session` on OpenCode
- `POST /sessions/:id/message` — proxy to `POST /session/:id/message` on OpenCode
- `GET /sessions/:id/messages` — proxy to `GET /session/:id/message` on OpenCode
- `POST /sessions/:id/abort` — proxy to `POST /session/:id/abort` on OpenCode

Each route: check daemon connected → build HttpRequest → send via DaemonConnection → return response.

### 3c: Server Setup

**File:** `packages/orchestrator/src/server.ts`

Creates HTTP server with Hono + WebSocket server with ws. Uses `noServer` mode to share the HTTP server. WSS upgrade handled on `/daemon` path with device key auth.

### 3d: Entry Point

**File:** `packages/orchestrator/src/index.ts`

Starts the server on port 3000.

---

## Task 4: Build Daemon

### 4a: OpenCode Process Manager

**File:** `packages/daemon/src/opencode-process.ts`

Manages the `opencode serve` child process:
- `start()` — spawns `opencode serve --port 4096`, waits for health check
- `stop()` — sends SIGTERM, waits for exit
- `waitForReady()` — polls `GET http://localhost:4096/global/health` until 200
- `isRunning()` — checks process state

### 4b: WSS Client + Relay

**File:** `packages/daemon/src/relay.ts`

WSS client that:
- Connects to orchestrator (`ws://localhost:3000/daemon?token=DEVICE_KEY`)
- On message: parse HttpRequest, relay to OpenCode via fetch, send back HttpResponse
- Heartbeat every 30 seconds

### 4c: Entry Point

**File:** `packages/daemon/src/index.ts`

1. Start OpenCode process
2. Wait for it to be ready
3. Connect WSS to orchestrator
4. Start relay

---

## Task 5: End-to-End Verification

**Prerequisites:**
- Orchestrator running on port 3000
- Daemon running (which starts opencode serve on port 4096)
- A git repo at the current working directory for opencode to work with

**Test script:**

```bash
# Terminal 1: Start orchestrator
cd packages/orchestrator && npm start

# Terminal 2: Start daemon (from a git repo directory)
cd packages/daemon && npm start

# Terminal 3: Test the relay

# 1. Health check
curl http://localhost:3000/health

# 2. List sessions
curl http://localhost:3000/sessions \
  -H "Authorization: Bearer mast-api-token-phase1"

# 3. Create a session
curl -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer mast-api-token-phase1" \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Send a message (use session ID from step 3)
curl -X POST http://localhost:3000/sessions/<SESSION_ID>/message \
  -H "Authorization: Bearer mast-api-token-phase1" \
  -H "Content-Type: application/json" \
  -d '{"parts": [{"type": "text", "text": "List the files in this repo"}]}'
```

**Done gate:** Step 4 returns OpenCode's response with a list of files. The full relay path works.
