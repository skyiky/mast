# Phase 5 Test Plan: Dogfood Readiness

## What Phase 5 Does

Phase 5 makes Mast deployable and usable for real development. After Phase 4, the product
has robust reconnection, sync, pairing, and health monitoring — but all tested against
localhost fakes. Phase 5 bridges the gap to reality:

1. **Orchestrator: Supabase session store** — Switch from `InMemorySessionStore` to
   `SupabaseSessionStore` for production. Session and message data persists across
   orchestrator restarts. The `SessionStore` interface is already defined; this implements
   the real adapter.
2. **Orchestrator: Railway deployment** — Dockerfile, env vars, health check route already
   exists. Configure Railway project, connect to GitHub, deploy.
3. **Daemon: Persistent device key** — After pairing, the daemon stores the issued device key
   to `~/.mast/device-key.json`. On subsequent starts, it loads the key and skips pairing.
4. **Daemon: OpenCode process management** — The daemon can spawn `opencode serve` as a child
   process, detect crashes, and restart it. This is the auto-restart path when health
   monitoring detects OpenCode is down.
5. **Mobile: Navigation + screens** — Add `expo-router` or `@react-navigation` for multi-screen
   navigation. New screens: Pairing, Settings, Session list. Update Chat screen with
   connection status, verbosity toggle, and proper rendering of all message part types
   (tool invocations, file changes, reasoning).
6. **Mobile: Push notifications** — Register for Expo push notifications, send token to
   orchestrator via `POST /push/register`. Handle incoming push taps to open the relevant
   session.

## Test Strategy

Phase 5 has two very different halves:

**Server-side (automated):** The SupabaseSessionStore and daemon key persistence are testable
with the same `node:test` framework. We use a test Supabase instance (or mock the client).

**Mobile + deployment (manual):** React Native screens, Railway deployment, real OpenCode
integration, and the full dogfood workflow are manual testing concerns. We define a manual
smoke test checklist instead of automated tests.

## Automated Tests

### 1. SupabaseSessionStore (supabase-store.test.ts)

These tests verify the production store implementation against the `SessionStore` interface.
We test against a real Supabase project (test instance) or a local PostgreSQL + PostgREST
to avoid mocking the Supabase client.

| # | Test | What it proves |
|---|------|----------------|
| 1 | `upsertSession` creates a new session, `listSessions` returns it | Basic CRUD |
| 2 | `upsertSession` with existing ID updates (no duplicate) | Upsert semantics |
| 3 | `addMessage` + `getMessages` round-trips correctly | Message storage |
| 4 | `getMessages` returns only messages for the requested session | Session isolation |
| 5 | `updateMessageParts` replaces parts array on existing message | Streaming part updates |
| 6 | `markMessageComplete` sets streaming to false | Completion tracking |
| 7 | `savePushToken` + `getPushTokens` stores and retrieves tokens | Push token storage |
| 8 | `getSession` returns null for non-existent session | Missing data handling |
| 9 | Messages ordered by creation time | Ordering guarantee |

### 2. Daemon Key Persistence (key-store.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 10 | `saveDeviceKey` writes key to `~/.mast/device-key.json` | Persistence works |
| 11 | `loadDeviceKey` reads previously saved key | Round-trip |
| 12 | `loadDeviceKey` returns null when no key file exists | First-run behavior |
| 13 | `clearDeviceKey` removes the stored key | Reset/re-pair |
| 14 | Key file has restricted permissions (600 on Unix) | Security |

### 3. Orchestrator with SupabaseSessionStore (integration)

| # | Test | What it proves |
|---|------|----------------|
| 15 | Full relay chain works with SupabaseSessionStore (GET /sessions) | Production store integrates |
| 16 | SSE events cached in Supabase, survive orchestrator restart | Persistence across restarts |
| 17 | Sync protocol backfills into Supabase correctly | Sync + Supabase together |

### 4. Daemon Process Management (process.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 18 | `OpenCodeProcess.start()` spawns child process, health check passes | Process spawning works |
| 19 | `OpenCodeProcess.stop()` kills child process cleanly | Clean shutdown |
| 20 | `OpenCodeProcess.restart()` kills and re-spawns | Recovery path |
| 21 | Process crash detected, `onCrash` callback fires | Crash detection |

**Note:** Tests 18-21 require a mock executable (a simple Node.js script that acts like
`opencode serve`) rather than the real OpenCode binary. The mock script listens on a port,
responds to `/global/health`, and can be signaled to crash.

### 5. Unit Tests

| # | Test | What it proves |
|---|------|----------------|
| 22 | `KeyStore` path resolution uses correct platform-specific directory | Cross-platform paths |
| 23 | Supabase client creation with env vars | Config loading |

## Test Infrastructure

### Supabase Test Instance

Option A: Use a dedicated Supabase project for tests (free tier).
- Pros: Tests real Supabase behavior, RLS, etc.
- Cons: Network dependency, slower, needs credentials in CI.

Option B: Use Supabase local dev (`supabase start`).
- Pros: No network dependency, fast, reproducible.
- Cons: Requires Docker, heavier setup.

**Decision:** Start with Option A (test project). Move to Option B if tests are flaky.

### Mock OpenCode Process

A simple Node.js script at `packages/daemon/test/mock-opencode.ts`:
```typescript
// Starts an HTTP server on a given port
// GET /global/health → 200 { status: "ok" }
// Exits on SIGTERM
// Optionally crashes after N seconds (for crash detection tests)
```

## Manual Smoke Test Checklist

### Pre-dogfood (done once)

- [ ] Railway project created, orchestrator deployed from GitHub
- [ ] Supabase project created, tables migrated (`sessions`, `messages`, `push_tokens`)
- [ ] Environment variables set on Railway: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PORT`
- [ ] Orchestrator health check passes from the internet: `curl https://<railway-url>/health`
- [ ] Daemon connects to Railway-hosted orchestrator via WSS
- [ ] Phone app connects to Railway-hosted orchestrator via WSS

### Pairing flow

- [ ] Start daemon with no stored key → 6-digit code appears in terminal
- [ ] Open phone app → navigate to pairing screen → enter code
- [ ] Pairing succeeds → phone shows "Connected" → daemon shows "Paired"
- [ ] Kill and restart daemon → connects automatically without re-pairing
- [ ] Enter wrong code → error shown on phone, can retry

### Real coding workflow

- [ ] Create a new session from the phone
- [ ] Send a prompt: "List the files in this directory"
- [ ] Agent responds with text → messages stream in real-time
- [ ] Agent requests permission to run a command → push notification received
- [ ] Tap push notification → app opens to the session with permission prompt
- [ ] Approve the permission → agent continues
- [ ] View the diff of changes → file paths, added/removed lines visible
- [ ] Send "Create a PR" → PR created on GitHub

### Resilience

- [ ] Kill daemon process mid-task → phone shows "daemon offline" after 30s
- [ ] Restart daemon → session resumes, missed messages backfilled
- [ ] Toggle airplane mode on phone briefly → app reconnects, no lost messages
- [ ] Kill phone app, reopen → session history loads from cache immediately
- [ ] Kill orchestrator, restart → daemon reconnects, sessions reload from Supabase

### Settings

- [ ] Settings screen accessible from navigation
- [ ] Connection status shows green dot when connected
- [ ] Verbosity toggle switches between Standard and Full
- [ ] Standard mode: tool invocations collapsed, reasoning hidden
- [ ] Full mode: everything shown

## Supabase Schema

```sql
-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  parts JSONB DEFAULT '[]'::jsonb,
  streaming BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Push tokens table
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

No RLS for Phase 5 (single-user). RLS deferred to multi-user support.

## Pass Criteria

1. All 23 automated tests pass.
2. Manual smoke test checklist fully checked.
3. Complete one real coding task entirely from the phone (the "dogfood test"):
   - Start task, approve plan, approve permissions, review diff, create PR.
   - At least one push notification received and acted on.
4. No "that's broken" moments during a full day of use.

## What We Explicitly Don't Test

- Multi-user / multi-device (single user, single device for now)
- Supabase RLS policies
- CI/CD pipeline
- App Store submission / TestFlight
- Performance under load
- Real network partition simulation (we use airplane mode toggle)
- Expo OTA updates
