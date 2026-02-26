# Claude Code Spike — Implementation Plan

> **Goal:** Add Claude Code as a first-class agent alongside OpenCode. Introduce a
> multi-agent adapter architecture with per-session agent routing and a semantic
> WSS protocol (replacing the current HTTP relay pattern).

**Branch:** `claude-code-spike`

---

## Architecture Summary

### Current State (OpenCode-only)

```
Orchestrator routes.ts           Daemon relay.ts
  forward("POST","/session/…")  ──WSS──>  fetch("http://localhost:4096/…")
  10 hardcoded OpenCode paths               SSE subscriber on /event
                                            HealthMonitor on /global/health
```

The orchestrator constructs raw HTTP requests, wraps them in `http_request` WSS
messages, the daemon proxies them to OpenCode via `fetch`, and returns
`http_response`. The daemon also subscribes to OpenCode's SSE stream and
forwards events verbatim.

### Target State (multi-agent)

```
Orchestrator                              Daemon
  send semantic command ─────WSS────>  AgentRouter
  { type: "send_prompt",                  │
    sessionId, text }                     ├── OpenCodeAdapter  (HTTP relay + SSE)
                                          └── ClaudeCodeAdapter (Agent SDK, in-process)
```

The orchestrator sends **semantic commands** (`list_sessions`, `send_prompt`,
`approve_permission`, etc.). The daemon's `AgentRouter` looks up which adapter
owns the session and dispatches. Each adapter translates semantic operations
into agent-specific API calls.

---

## Task 1: Define the AgentAdapter Interface

**File:** `packages/daemon/src/agent-adapter.ts` (new)

```typescript
import { EventEmitter } from "node:events";

// Mast's canonical event types (agent-agnostic)
export type MastEventType =
  | "mast.message.created"
  | "mast.message.part.created"
  | "mast.message.part.updated"
  | "mast.message.completed"
  | "mast.permission.created"
  | "mast.permission.updated"
  | "mast.session.updated";

export interface MastEvent {
  type: MastEventType;
  sessionId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface MastSession {
  id: string;
  title?: string;
  agentType: string;        // "opencode" | "claude-code"
  createdAt: string;
}

export interface MastMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  completed: boolean;
}

export interface MastPermission {
  id: string;
  sessionId: string;
  description: string;
  toolName?: string;
  status: "pending" | "approved" | "denied";
}

export interface AgentAdapter extends EventEmitter {
  readonly agentType: string;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;

  // Sessions
  listSessions(): Promise<MastSession[]>;
  createSession(): Promise<MastSession>;

  // Messaging
  sendPrompt(sessionId: string, text: string): void;
  abortSession(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<MastMessage[]>;

  // Permissions
  approvePermission(sessionId: string, permissionId: string): void;
  denyPermission(sessionId: string, permissionId: string): void;

  // Diff
  getDiff(sessionId: string): Promise<unknown>;

  // Events — emit MastEvent via EventEmitter
  // adapter.on("event", (e: MastEvent) => { ... })
}
```

**Why EventEmitter:** Adapters emit events at their own pace (SSE stream for
OpenCode, async iterator for Claude Code). The router subscribes once.

---

## Task 2: Implement OpenCodeAdapter

**File:** `packages/daemon/src/adapters/opencode-adapter.ts` (new)

Wraps the existing relay + SSE + health logic behind the AgentAdapter interface.

- `start()` → starts `OpenCodeProcess`, `SseSubscriber`, `HealthMonitor`
- `stop()` → stops all three
- `healthCheck()` → single `/global/health` fetch
- `listSessions()` → `GET /session`
- `createSession()` → `POST /session`
- `sendPrompt(id, text)` → `POST /session/${id}/prompt_async` with `{ parts: [{ type: "text", text }] }`
- `abortSession(id)` → `POST /session/${id}/abort`
- `getMessages(id)` → `GET /session/${id}/message`
- `approvePermission(id, pid)` → `POST /session/${id}/permissions/${pid}` with `{ approve: true }`
- `denyPermission(id, pid)` → `POST /session/${id}/permissions/${pid}` with `{ approve: false }`
- `getDiff(id)` → `GET /session/${id}/diff`
- SSE events → normalize and re-emit as `MastEvent` with `mast.*` type names

**Key mapping — OpenCode SSE → MastEvent:**

| OpenCode event          | MastEvent type                |
|-------------------------|-------------------------------|
| `message.created`       | `mast.message.created`        |
| `message.part.created`  | `mast.message.part.created`   |
| `message.part.updated`  | `mast.message.part.updated`   |
| `message.completed`     | `mast.message.completed`      |
| `permission.created`    | `mast.permission.created`     |
| `permission.updated`    | `mast.permission.updated`     |
| `session.updated`       | `mast.session.updated`        |

Existing files consumed/replaced:
- `relay.ts` — OpenCode-specific HTTP relay logic moves here
- `sse-client.ts` — used as-is inside the adapter
- `health-monitor.ts` — used as-is inside the adapter
- `opencode-process.ts` — used as-is inside the adapter

---

## Task 3: Implement ClaudeCodeAdapter

**File:** `packages/daemon/src/adapters/claude-code-adapter.ts` (new)

**Dependency:** `@anthropic-ai/claude-agent-sdk`

```bash
npm install @anthropic-ai/claude-agent-sdk --workspace=packages/daemon
```

### Core mechanics

```typescript
import { query, type Tool } from "@anthropic-ai/claude-agent-sdk";

class ClaudeCodeAdapter extends EventEmitter implements AgentAdapter {
  readonly agentType = "claude-code";
  private sessions = new Map<string, { messageHistory: Message[] }>();
  private pendingPermissions = new Map<string, {
    resolve: (result: { behavior: "allow" | "deny" }) => void;
  }>();

  async start() { /* validate ANTHROPIC_API_KEY exists */ }
  async stop()  { /* abort any running queries */ }
  async healthCheck() { return !!process.env.ANTHROPIC_API_KEY; }

  createSession(): Promise<MastSession> {
    const id = crypto.randomUUID();
    this.sessions.set(id, { messageHistory: [] });
    return { id, agentType: "claude-code", ... };
  }

  sendPrompt(sessionId: string, text: string): void {
    // Fire-and-forget — events stream back via EventEmitter
    this.runQuery(sessionId, text).catch(err => { ... });
  }

  private async runQuery(sessionId: string, text: string) {
    const session = this.sessions.get(sessionId);
    const stream = query({
      prompt: text,
      options: {
        maxTurns: 50,
        canUseTool: async (tool: Tool) => {
          // Emit permission.created, wait for resolve
          const pid = crypto.randomUUID();
          this.emit("event", {
            type: "mast.permission.created",
            sessionId,
            data: {
              permission: {
                id: pid,
                description: tool.name,
                toolName: tool.name,
                input: tool.input,
              },
            },
            timestamp: new Date().toISOString(),
          });

          return new Promise((resolve) => {
            this.pendingPermissions.set(pid, { resolve });
          });
        },
      },
    });

    for await (const event of stream) {
      // Map Claude SDK events → MastEvent and emit
    }
  }

  approvePermission(_sessionId: string, pid: string): void {
    const pending = this.pendingPermissions.get(pid);
    if (pending) {
      pending.resolve({ behavior: "allow" });
      this.pendingPermissions.delete(pid);
    }
  }

  denyPermission(_sessionId: string, pid: string): void {
    const pending = this.pendingPermissions.get(pid);
    if (pending) {
      pending.resolve({ behavior: "deny" });
      this.pendingPermissions.delete(pid);
    }
  }
}
```

### Permission flow

```
Phone taps "Approve"
  → POST /sessions/:id/approve/:pid
  → Orchestrator sends { type: "approve_permission", sessionId, permissionId }
  → Daemon AgentRouter dispatches to ClaudeCodeAdapter
  → Adapter resolves the stored Promise → { behavior: "allow" }
  → canUseTool callback returns → Claude proceeds
```

---

## Task 4: Implement AgentRouter

**File:** `packages/daemon/src/agent-router.ts` (new)

Routes semantic commands to the correct adapter based on session ownership.

```typescript
class AgentRouter {
  private adapters = new Map<string, AgentAdapter>();    // "opencode" → adapter
  private sessionOwner = new Map<string, string>();       // sessionId → agentType

  registerAdapter(adapter: AgentAdapter): void { ... }

  // Unified operations — look up session owner, dispatch to adapter
  async listSessions(): Promise<MastSession[]> { /* merge from all adapters */ }
  async createSession(agentType: string): Promise<MastSession> { ... }
  sendPrompt(sessionId: string, text: string): void { ... }
  approvePermission(sessionId: string, pid: string): void { ... }
  denyPermission(sessionId: string, pid: string): void { ... }
  // ... etc.

  // Aggregate events from all adapters
  onEvent(handler: (event: MastEvent) => void): void {
    for (const adapter of this.adapters.values()) {
      adapter.on("event", handler);
    }
  }
}
```

**Session creation:** Phone must specify `agentType` when creating a session:
`POST /sessions { agentType: "claude-code" }`. If omitted, default to whatever
agents are available (prefer OpenCode if both are running).

---

## Task 5: Rewrite the WSS Protocol (Semantic Commands)

**File:** `packages/shared/src/protocol.ts` (modify)

### New Orchestrator → Daemon messages

Replace `HttpRequest` with semantic command types:

```typescript
interface ListSessionsCommand {
  type: "list_sessions";
  requestId: string;
}

interface CreateSessionCommand {
  type: "create_session";
  requestId: string;
  agentType?: string;   // "opencode" | "claude-code"
}

interface SendPromptCommand {
  type: "send_prompt";
  requestId: string;
  sessionId: string;
  text: string;
}

interface ApprovePermissionCommand {
  type: "approve_permission";
  requestId: string;
  sessionId: string;
  permissionId: string;
}

interface DenyPermissionCommand {
  type: "deny_permission";
  requestId: string;
  sessionId: string;
  permissionId: string;
}

interface GetMessagesCommand {
  type: "get_messages";
  requestId: string;
  sessionId: string;
}

interface GetDiffCommand {
  type: "get_diff";
  requestId: string;
  sessionId: string;
}

interface AbortSessionCommand {
  type: "abort_session";
  requestId: string;
  sessionId: string;
}

type OrchestratorCommand =
  | ListSessionsCommand
  | CreateSessionCommand
  | SendPromptCommand
  | ApprovePermissionCommand
  | DenyPermissionCommand
  | GetMessagesCommand
  | GetDiffCommand
  | AbortSessionCommand;
```

### New Daemon → Orchestrator responses

Replace `HttpResponse` with:

```typescript
interface CommandResult {
  type: "command_result";
  requestId: string;
  status: "ok" | "error";
  data?: unknown;
  error?: string;
}
```

### Updated status message

```typescript
interface DaemonStatus {
  type: "status";
  agentReady: boolean;           // renamed from opencodeReady
  agents: Array<{
    type: string;                // "opencode" | "claude-code"
    ready: boolean;
  }>;
}
```

### Updated event message

```typescript
interface EventMessage {
  type: "event";
  event: {
    type: MastEventType;         // "mast.message.created" etc.
    sessionId: string;
    data: Record<string, unknown>;
  };
  timestamp: string;
}
```

**Backward compat:** NOT a concern. Phone ↔ Orchestrator uses REST (unchanged).
Only Orchestrator ↔ Daemon is affected, and both are deployed together.

---

## Task 6: Update Orchestrator Routes

**File:** `packages/orchestrator/src/routes.ts` (modify)

Replace the `forward()` helper (which constructs raw HTTP paths) with calls to
`daemonConnection.sendCommand()`:

```typescript
// Before:
forward(daemonConnection, "POST", `/session/${id}/prompt_async`, body)

// After:
daemonConnection.sendCommand({
  type: "send_prompt",
  requestId: generateRequestId(),
  sessionId: id,
  text: extractText(body),
})
```

No more path translation (`/prompt` → `/prompt_async`, `/approve/:pid` →
`/permissions/:pid`). The orchestrator speaks Mast semantics, not OpenCode HTTP.

---

## Task 7: Update DaemonConnection

**File:** `packages/orchestrator/src/daemon-connection.ts` (modify)

- Add `sendCommand(cmd: OrchestratorCommand)` method (replaces `sendRequest`)
- Update `handleMessage` to accept `CommandResult` instead of `HttpResponse`
- Keep `onEvent`, `onStatus`, `onSyncResponse` callbacks but update types

---

## Task 8: Update Daemon Message Handler

**File:** `packages/daemon/src/relay.ts` (modify heavily, possibly rename)

Replace `handleMessage` switch:

```typescript
// Before: case "http_request" → relayRequest(msg)
// After:
case "list_sessions":   → router.listSessions() → send CommandResult
case "send_prompt":     → router.sendPrompt(sessionId, text) → send CommandResult
case "approve_permission": → router.approvePermission(sessionId, pid) → send CommandResult
// ... etc.
```

The relay's HTTP proxying logic moves into `OpenCodeAdapter`. The relay becomes
a thin WSS message handler + AgentRouter dispatcher.

---

## Task 9: Update Event Type References

### Orchestrator `server.ts` — `cacheEvent()`

Update the switch from OpenCode event names to Mast event names:

```typescript
// Before: case "message.created":
// After:  case "mast.message.created":
```

### Orchestrator `push-notifications.ts` — `decidePush()`

```typescript
// Before: case "permission.created":
// After:  case "mast.permission.created":
```

### Phone `event-handler.ts`

Update event type strings from `message.created` → `mast.message.created`.

### Phone `connection.ts` store

Rename `opencodeReady` → `agentReady`. Add `agents` array.

---

## Task 10: Update Daemon Entry Point

**File:** `packages/daemon/src/index.ts` (modify)

```typescript
// Before:
const relay = new Relay(ORCHESTRATOR_URL, opencode.baseUrl, deviceKey);

// After:
const router = new AgentRouter();

// Register OpenCode adapter (if available)
if (process.env.MAST_SKIP_OPENCODE !== "1") {
  const opencode = new OpenCodeAdapter({ port: OPENCODE_PORT });
  await opencode.start();
  router.registerAdapter(opencode);
}

// Register Claude Code adapter (if ANTHROPIC_API_KEY is set)
if (process.env.ANTHROPIC_API_KEY) {
  const claude = new ClaudeCodeAdapter();
  await claude.start();
  router.registerAdapter(claude);
}

const relay = new SemanticRelay(ORCHESTRATOR_URL, router, deviceKey);
await relay.connect();
```

---

## Task 11: Update Tests

Existing tests use `fake-opencode.ts` (mock HTTP server). These continue to work
for OpenCodeAdapter tests. New tests needed:

- **`adapters/opencode-adapter.test.ts`** — unit tests for the adapter wrapping
  the existing OpenCode integration
- **`adapters/claude-code-adapter.test.ts`** — unit tests with mocked Agent SDK
  (`query()` function). Test permission flow (canUseTool → pending → resolve).
- **`agent-router.test.ts`** — routing, session ownership, multi-adapter listing
- **`semantic-relay.test.ts`** — semantic command parsing, dispatch, response

Update existing integration tests to use `mast.*` event type names.

---

## Execution Order

**Phase A — Adapter layer (daemon-only, no protocol change yet):**
1. Task 1: AgentAdapter interface
2. Task 2: OpenCodeAdapter (extract from relay.ts)
3. Task 3: ClaudeCodeAdapter (Agent SDK integration)
4. Task 4: AgentRouter

**Phase B — Protocol rewrite (orchestrator + daemon + shared):**
5. Task 5: New protocol types in shared
6. Task 6: Orchestrator routes → semantic commands
7. Task 7: DaemonConnection update
8. Task 8: Daemon relay → semantic handler

**Phase C — Cleanup:**
9. Task 9: Event type renaming across all packages
10. Task 10: Daemon entry point update
11. Task 11: Tests

**Checkpoint after Phase A:** OpenCodeAdapter and ClaudeCodeAdapter should both
pass unit tests independently, exercised via the AgentRouter, before touching
the protocol.

---

## Environment Variables (new)

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for Claude Code adapter |
| `MAST_DEFAULT_AGENT` | `opencode` | Default agent when creating sessions without explicit type |

---

## Risk Areas

1. **Claude Agent SDK maturity** — SDK is relatively new. `canUseTool` callback
   API may change. Pin to a specific version.
2. **Session ID format** — OpenCode generates session IDs internally. Claude Code
   adapter generates its own. Must not collide (UUID for both is fine).
3. **Event stream mapping** — Claude SDK's `query()` iterator yields different
   event shapes than OpenCode SSE. Need careful mapping in Task 3.
4. **Test isolation** — Claude Code tests must mock the SDK, not make real API
   calls. Use dependency injection for `query()`.
