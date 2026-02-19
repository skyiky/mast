# Phase 3 Test Plan: Permissions, Diffs, Session Cache (Supabase), Push Notifications

## What Phase 3 Does

Phase 3 makes the product useful for real work. A developer can start a coding task, approve
agent actions from their phone, review diffs of changed files, and get notified when the agent
needs attention.

Five server-side additions:

1. **Orchestrator: Permission approval routes** — `POST /sessions/:id/approve/:pid` and
   `POST /sessions/:id/deny/:pid` translate to OpenCode's `POST /session/:id/permissions/:pid`
2. **Orchestrator: Session cache via Supabase** — Writes messages to Supabase Postgres as
   they flow through the relay. Phone reads from Supabase-backed cache for history, offline
   browsing, and fast session list loading.
3. **Orchestrator: Push notification module** — Registers Expo push tokens (stored in
   Supabase), decides when to send notifications, deduplicates rapid events
4. **Supabase project setup** — Tables: `sessions`, `messages`, `push_tokens`. Row-level
   security deferred to Phase 4 (single-user for now).
5. **Mobile: Permission cards, diff viewer, session list, push registration** — Not tested
   here (React Native is a separate manual testing concern)

Daemon: No changes. The relay already forwards permission and diff requests.

## Supabase Integration

### Schema

```sql
-- Sessions observed by the orchestrator
create table sessions (
  id text primary key,                -- OpenCode session ID
  title text,
  status text default 'active',       -- active | completed | error
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Messages cached as they flow through the relay
create table messages (
  id text primary key,                -- OpenCode message ID
  session_id text references sessions(id) on delete cascade,
  role text not null,                 -- user | assistant
  parts jsonb not null default '[]',  -- raw OpenCode message parts
  streaming boolean default false,
  created_at timestamptz default now()
);

-- Expo push tokens for notification delivery
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,         -- Expo push token (ExponentPushToken[...])
  created_at timestamptz default now()
);
```

Note: `users`, `devices`, `approval_policies`, and `notification_prefs` tables from the ADR
are deferred to Phase 4 (multi-user). Phase 3 is single-user, so we skip user/device
foreign keys for now.

### Write strategy

Supabase writes are **fire-and-forget on the streaming path.** The orchestrator does NOT
await the database write before forwarding an event to the phone. This keeps the hot path
(SSE event → phone WSS) at zero additional latency.

```
Event arrives from daemon
  ├── (sync)  Forward to phone WSS immediately
  └── (async) Write to Supabase in background (log errors, don't block)
```

Reads from Supabase are awaited normally (session list, message history).

### Architecture in the code

The orchestrator uses a `SessionStore` interface:

```typescript
interface SessionStore {
  upsertSession(session: { id: string; title?: string; status?: string }): Promise<void>;
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  addMessage(msg: { id: string; sessionId: string; role: string; parts: unknown[] }): Promise<void>;
  updateMessageParts(id: string, parts: unknown[]): Promise<void>;
  markMessageComplete(id: string): Promise<void>;
  getMessages(sessionId: string): Promise<Message[]>;
  savePushToken(token: string): Promise<void>;
  getPushTokens(): Promise<string[]>;
}
```

Two implementations:
- **`SupabaseSessionStore`** — Production implementation using `@supabase/supabase-js`
- **`InMemorySessionStore`** — Used in automated tests (fast, deterministic, no network)

Both implement the same interface. Tests validate behavior via `InMemorySessionStore`.
A separate manual smoke test verifies the real Supabase integration.

## Test Strategy

Same as Phases 1–2: **fake OpenCode server** extended with permission-aware handlers.
Framework: `node:test` + `node:assert` (zero dependencies).

**Key testing decision:** Automated tests use `InMemorySessionStore`, not real Supabase.
This keeps tests fast, deterministic, offline-capable, and free of credential requirements.
The `SupabaseSessionStore` is a thin adapter over `@supabase/supabase-js` — its correctness
is verified by manual smoke testing against a real Supabase project.

New test infrastructure:
- **Fake Expo push server** — Minimal HTTP server that records push notification payloads
  sent to it, so we can assert on what notifications the orchestrator would send without
  depending on Expo's real infrastructure

## Test Architecture

```
                                              ┌───────────┐
                                              │  Phone WS │ ◄──── events (permissions, etc.)
                                              │  (test)   │
                                              └─────┬─────┘
                                                    │ WSS
┌─────────────┐     HTTP      ┌─────────────────────┴──┐     WSS      ┌────────┐   HTTP+SSE  ┌──────────────┐
│  Test runner │ ──────────►  │     Orchestrator        │ ◄──────────► │ Daemon │ ──────────► │ Fake OpenCode│
│  (fetch)     │              │  + InMemorySessionStore │              │        │             │  (port C)    │
│              │              │  + push notification    │              └────────┘             └──────────────┘
└─────────────┘               │    module               │
                              └─────────┬───────────────┘
                                        │ HTTP (push sends)
                                  ┌─────▼──────────┐
                                  │ Fake Expo Push  │
                                  │   Server        │
                                  └────────────────┘
```

Production deployment replaces `InMemorySessionStore` with `SupabaseSessionStore`:

```
Orchestrator ──── @supabase/supabase-js ────► Supabase Postgres
```

## Test Categories

### 1. Integration Tests — Permission Approval Flow

| # | Test | What it proves |
|---|------|----------------|
| 1 | `POST /sessions/:id/approve/:pid` relays to fake OpenCode `POST /session/:id/permissions/:pid` | Approval relay works |
| 2 | `POST /sessions/:id/deny/:pid` relays to fake OpenCode `POST /session/:id/permissions/:pid` | Denial relay works |
| 3 | Approval request body sent to OpenCode is correct (`{ approve: true }`) | Protocol translation correct |
| 4 | Denial request body sent to OpenCode is correct (`{ approve: false }`) | Protocol translation correct |
| 5 | Approve/deny when daemon disconnected returns 503 | Consistent error handling |
| 6 | Full permission loop: prompt → `permission.created` event on phone → approve → `permission.updated` event on phone | Complete approval workflow E2E |
| 7 | Full denial loop: prompt → `permission.created` event → deny → `permission.updated` event | Complete denial workflow E2E |

### 2. Integration Tests — Session Cache (via InMemorySessionStore)

| # | Test | What it proves |
|---|------|----------------|
| 8 | Messages flowing through relay are captured in session store | Store intercepts relay traffic |
| 9 | `GET /sessions/:id/messages` returns stored messages when daemon is disconnected | Store serves offline |
| 10 | `GET /sessions` returns stored session list when daemon is disconnected | Session list serves offline |
| 11 | Store captures both user prompts and assistant messages from SSE events | Both directions captured |
| 12 | Store does not return messages from a different session | Session isolation |
| 13 | New messages arriving via SSE update the store incrementally | Store stays current |

### 3. Integration Tests — Push Notifications

| # | Test | What it proves |
|---|------|----------------|
| 14 | `POST /push/register` stores an Expo push token via session store | Token registration works |
| 15 | `permission.created` event triggers push to fake Expo server when no phone connected | Permission push fires |
| 16 | `permission.created` event does NOT trigger push when phone IS connected | No redundant push |
| 17 | Push payload includes permission description (e.g., "Agent wants to run: npm test") | Payload is useful |
| 18 | Rapid `message.part.updated` events are debounced (only one "agent working" push per 5 min) | Deduplication works |
| 19 | Daemon disconnect triggers push after 30s debounce | Offline notification with grace period |
| 20 | Daemon reconnect within 30s cancels the disconnect push | False alarm suppressed |

### 4. Integration Tests — Diff Relay (explicit verification)

| # | Test | What it proves |
|---|------|----------------|
| 21 | `GET /sessions/:id/diff` returns structured diff from fake OpenCode | Diff data flows through |
| 22 | Diff response includes file paths, added/removed line counts | Format matches mobile expectations |

### 5. Integration Tests — Regression

| # | Test | What it proves |
|---|------|----------------|
| 23 | Phase 1 GET relay still works | No regression |
| 24 | Phase 2 SSE streaming still works | No regression |

### 6. Unit Tests

| # | Test | What it proves |
|---|------|----------------|
| 1 | InMemorySessionStore: add message, get messages, list sessions | CRUD correctness |
| 2 | InMemorySessionStore: messages from different sessions don't leak | Isolation |
| 3 | InMemorySessionStore: updateMessageParts + markMessageComplete | Streaming lifecycle |
| 4 | Push decision logic: which event types trigger notifications | Decision table correctness |
| 5 | Push deduplication: timer resets on new event, fires after quiet period | Timing logic |
| 6 | Push deduplication: different event categories tracked independently | Per-category dedup |

## Fake OpenCode Extensions

The fake server gains programmable permission handling:

```typescript
// Register a permission handler
fakeOpenCode.handle("POST", "/session/sess1/permissions/perm1", {
  status: 200,
  body: { id: "perm1", status: "approved" },
});

// After the test, inspect what was sent:
const reqs = fakeOpenCode.requests();
const approvalReq = reqs.find(r => r.path.includes("/permissions/"));
assert.deepStrictEqual(approvalReq.body, { approve: true });
```

No new fake OpenCode code needed for permissions — the existing programmable handler system
already supports arbitrary method+path combinations. We just register handlers in each test.

## Fake Expo Push Server

New test infrastructure — minimal HTTP server:

```typescript
interface FakeExpoPush {
  port: number;
  /** All push payloads received */
  notifications(): Array<{ to: string; title: string; body: string; data?: unknown }>;
  /** Clear recorded notifications */
  reset(): void;
  close(): Promise<void>;
}
```

The orchestrator's push module is configured to send to `http://localhost:<port>/push` instead
of Expo's real endpoint. This is injected via config, not hardcoded.

## Diff Response Format

The fake OpenCode returns diffs in this shape (matching OpenCode's actual format):

```json
{
  "files": [
    {
      "path": "src/index.ts",
      "additions": 12,
      "deletions": 3,
      "patch": "@@ -1,5 +1,14 @@\n-old line\n+new line\n..."
    }
  ]
}
```

## Manual Smoke Test: Supabase Integration

After automated tests pass, verify the real Supabase adapter manually:

1. Create the schema in a Supabase project (run the SQL from above)
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`
3. Start the orchestrator with `--store=supabase` (or env var)
4. Run a session through the relay — verify rows appear in Supabase dashboard
5. Kill the daemon, verify `GET /sessions` and `GET /sessions/:id/messages` still return data
6. Register a push token via `POST /push/register`, verify row in `push_tokens` table

## Pass Criteria

All automated tests pass. No timeouts. Clean shutdown.
Phase 1 tests (19) + Phase 2 tests (9) + Phase 3 tests still all pass together.
Manual Supabase smoke test passes.

## What We Explicitly Don't Test

- React Native UI components (permission cards, diff viewer, session list screen)
- Actual Expo push notification delivery to a real device
- Actual OpenCode behavior
- SupabaseSessionStore in automated tests (tested manually)
- Row-level security / multi-user isolation (Phase 4)
- Multiple simultaneous coding tasks (Phase 4)
- Network resilience / reconnection edge cases (Phase 4)
- Performance under load (Phase 4)

## New Dependencies

- `@supabase/supabase-js` — added to `@mast/orchestrator` package
