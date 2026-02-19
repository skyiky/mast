# Phase 4 Test Plan: Pairing, Reconnection, Cache Sync, Settings

## What Phase 4 Does

Phase 4 makes Mast robust enough for daily use. After Phase 3, the product works end-to-end
but assumes a stable connection, a single pre-configured device, and no restarts. Phase 4
adds the real-world resilience layer: what happens when the network drops, the daemon
restarts, the app is killed, or a new machine is paired.

Six additions across the stack:

1. **Daemon: Pairing flow** — On first run (no stored device key), the daemon generates a
   6-digit pairing code and displays it in the terminal. The user enters this code on their
   phone. The orchestrator verifies the code and issues a permanent device key. The daemon
   stores the key for future connections.
2. **Orchestrator: Pairing endpoints** — `POST /pair/initiate` (daemon sends pairing code),
   `POST /pair/verify` (phone submits code + gets device key). Pairing codes expire after
   5 minutes. Only one active pairing code per orchestrator instance at a time.
3. **Daemon: Reconnection with cache sync** — On reconnect after a disconnect, the daemon
   sends a `sync_request` message containing the IDs of sessions the orchestrator has cached
   and the timestamp of the last received event. The daemon queries OpenCode for any
   messages that arrived during the gap and sends them as a `sync_response`.
4. **Orchestrator: Sync protocol handling** — On daemon reconnect, orchestrator sends
   `sync_request` with `{ cachedSessionIds, lastEventTimestamp }`. Processes incoming
   `sync_response` to backfill missed messages into the session store.
5. **Daemon: OpenCode health monitoring** — Periodic health check of the local OpenCode
   server (`GET /global/health`). If the server dies, the daemon auto-restarts it via
   `opencode serve` and re-establishes the SSE subscription.
6. **Mobile: Settings screen, verbosity toggle, pairing UI** — Not tested here
   (React Native is a separate manual testing concern).

## New Protocol Messages

Added to `@mast/shared` protocol.ts:

```typescript
// Orchestrator -> Daemon
export interface SyncRequest {
  type: "sync_request";
  cachedSessionIds: string[];
  lastEventTimestamp: string;  // ISO 8601
}

// Daemon -> Orchestrator
export interface SyncResponse {
  type: "sync_response";
  sessions: Array<{
    id: string;
    messages: Array<{
      id: string;
      role: string;
      parts: unknown[];
      completed: boolean;
    }>;
  }>;
}

// Daemon -> Orchestrator (during pairing)
export interface PairRequest {
  type: "pair_request";
  pairingCode: string;
}

// Orchestrator -> Daemon (pairing result)
export interface PairResponse {
  type: "pair_response";
  success: boolean;
  deviceKey?: string;
  error?: string;
}
```

## Pairing Flow

### Happy path
```
1. Daemon starts with no stored device key
2. Daemon connects to orchestrator WSS at /daemon?token=pairing
3. Daemon generates 6-digit code, displays in terminal
4. Daemon sends { type: "pair_request", pairingCode: "123456" }
5. Orchestrator stores code with 5-minute expiry
6. User opens phone, enters code on pairing screen
7. Phone sends POST /pair/verify { code: "123456" }
8. Orchestrator validates code, generates device key
9. Orchestrator sends { type: "pair_response", success: true, deviceKey: "dk_..." }
10. Orchestrator returns device key to phone too (so phone knows device name)
11. Daemon stores device key locally, reconnects with real key
12. Future connections use stored device key directly
```

### Edge cases
- Expired code (>5 min) → `pair_response` with `success: false, error: "code_expired"`
- Wrong code → `pair_response` with `success: false, error: "invalid_code"`
- Second pairing attempt while first is pending → first code is invalidated
- Daemon disconnects before pairing completes → code is cleaned up

## Reconnection & Cache Sync Protocol

### Timeline
```
1. Daemon connected, events flowing normally
2. Network drops / daemon process killed
3. Orchestrator detects disconnect (ws close), starts push grace period
4. Daemon restarts, connects to orchestrator
5. Orchestrator receives new daemon connection:
   a. Sends sync_request: { cachedSessionIds: [...], lastEventTimestamp: "..." }
   b. Cancels daemon-offline push notification
6. Daemon receives sync_request:
   a. Queries OpenCode for each cached session's messages
   b. Finds messages newer than lastEventTimestamp
   c. Sends sync_response with missed messages
7. Orchestrator receives sync_response:
   a. Backfills missed messages into session store
   b. Broadcasts backfilled messages to connected phone clients
8. Normal event flow resumes via SSE subscription
```

### Edge cases
- No cached sessions → `sync_request` with empty arrays, `sync_response` with empty sessions
- Session was deleted in OpenCode during disconnect → OpenCode returns 404, session marked
  as deleted in store
- Daemon reconnects but OpenCode is down → daemon can't fulfill sync, sends empty response
  with error flag, starts OpenCode health recovery

## OpenCode Health Monitoring

```
1. Daemon runs health check every 30 seconds: GET http://localhost:4096/global/health
2. If health check fails (network error or non-200):
   a. Increment failure counter
   b. After 3 consecutive failures: mark OpenCode as down
   c. Send status update: { type: "status", opencodeReady: false }
   d. Attempt restart: spawn `opencode serve`, wait for health check to pass
   e. On recovery: send { type: "status", opencodeReady: true }
   f. Re-establish SSE subscription
3. If health check passes: reset failure counter
```

## Test Strategy

Same framework as Phases 1–3: `node:test` + `node:assert`. Fake OpenCode server extended
with programmable health check responses and session query endpoints.

**Key testing decisions:**
- Reconnection tests use the real daemon `Relay` class connecting to a local orchestrator,
  with a fake OpenCode behind it. We can simulate disconnect by closing the WSS connection
  from the server side.
- Pairing tests use HTTP requests to orchestrator endpoints + WSS messages.
- Health monitoring tests use a fake OpenCode that can be toggled between healthy and dead.
- Cache sync tests verify that messages missed during disconnect are backfilled correctly.
- We do NOT test actual `opencode serve` process management (that requires a real binary).
  Instead, we test the health check logic and the state machine transitions.

## Test Architecture

```
                                               ┌───────────┐
                                               │  Phone WS │ ◄─── events + sync backfill
                                               │  (test)   │
                                               └─────┬─────┘
                                                     │ WSS
┌─────────────┐     HTTP      ┌───────────────────────┴──┐     WSS      ┌────────┐   HTTP+SSE  ┌──────────────┐
│  Test runner │ ──────────►  │     Orchestrator          │ ◄──────────► │ Daemon │ ──────────► │ Fake OpenCode│
│  (fetch)     │              │  + InMemorySessionStore   │              │ Relay  │             │  (port C)    │
│              │              │  + pairing state          │              └────────┘             │  toggleable  │
└─────────────┘               │  + sync protocol          │                                    │  health      │
                              └───────────────────────────┘                                    └──────────────┘
```

## Test Categories

### 1. Integration Tests — Pairing Flow (pairing.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 1 | Daemon connects with `token=pairing`, sends `pair_request` with 6-digit code | Unpaired daemon can initiate pairing |
| 2 | `POST /pair/verify` with correct code returns device key | Phone-side verification works |
| 3 | After successful pairing, daemon receives `pair_response` with `success: true` and device key | Daemon gets the key via WSS |
| 4 | Daemon reconnects with issued device key, connection accepted | Issued key is valid for future connections |
| 5 | `POST /pair/verify` with wrong code returns error | Invalid code rejected |
| 6 | `POST /pair/verify` after 5-minute expiry returns `code_expired` error | Time-based expiry works |
| 7 | New `pair_request` invalidates previous pending code | Only one active code at a time |
| 8 | Daemon disconnects before pairing completes, code is cleaned up | No dangling pairing state |

### 2. Integration Tests — Reconnection & Cache Sync (reconnect.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 9 | Daemon disconnect → orchestrator detects, `daemonConnected` becomes false | Disconnect detection works |
| 10 | Daemon reconnects → orchestrator sends `sync_request` with cached session IDs | Sync protocol initiates on reconnect |
| 11 | `sync_request` includes `lastEventTimestamp` matching the last event received | Timestamp tracking is accurate |
| 12 | Daemon responds with `sync_response` containing missed messages | Daemon fulfills sync request |
| 13 | Missed messages from `sync_response` appear in session store after processing | Backfill writes to store |
| 14 | Missed messages from `sync_response` are broadcast to connected phone clients | Phone gets backfilled events |
| 15 | Reconnect with empty cache → `sync_request` has empty `cachedSessionIds` | Edge case: fresh orchestrator |
| 16 | Reconnect when no messages were missed → `sync_response` has empty sessions | No unnecessary backfill |
| 17 | Session deleted in OpenCode during disconnect → marked as deleted in store | Stale session cleanup |
| 18 | Multiple rapid disconnects/reconnects → only one sync per stable connection | No sync storms |

### 3. Integration Tests — OpenCode Health Monitoring (health.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 19 | Health check passes → no state change, `opencodeReady` stays true | Healthy state is stable |
| 20 | 1-2 health check failures → no state change (transient tolerance) | Doesn't flap on transient errors |
| 21 | 3 consecutive failures → `opencodeReady` becomes false, status message sent | Persistent failure detected |
| 22 | After failure, health check passes again → `opencodeReady` becomes true | Recovery is detected |
| 23 | Status update (`opencodeReady: false`) reaches orchestrator and is reflected in `/health` | Orchestrator tracks OpenCode health |
| 24 | Health check during disconnect → failures don't trigger status messages (no WSS) | No crash when WSS is down |

### 4. Integration Tests — Daemon Reconnect Timing (timing.test.ts)

| # | Test | What it proves |
|---|------|----------------|
| 25 | First reconnect attempt happens after ~1s (±30% jitter) | Base delay is correct |
| 26 | Second attempt after ~2s, third after ~4s (exponential backoff) | Exponential growth works |
| 27 | Backoff caps at 30s | Max delay is enforced |
| 28 | Successful reconnect resets the backoff counter | Clean state after recovery |
| 29 | `disconnect()` stops reconnection attempts | Graceful shutdown stops retry loop |

### 5. Integration Tests — Regression

| # | Test | What it proves |
|---|------|----------------|
| 30 | Phase 1 GET relay still works | No regression |
| 31 | Phase 2 SSE streaming still works | No regression |
| 32 | Phase 3 permissions still work | No regression |
| 33 | Phase 3 cache still works | No regression |
| 34 | Phase 3 push notifications still work | No regression |

### 6. Unit Tests

| # | Test | What it proves |
|---|------|----------------|
| 1 | Pairing code generation produces 6-digit numeric strings | Format correctness |
| 2 | Pairing code expiry check returns false after 5 minutes | Expiry logic |
| 3 | `buildSyncRequest` with cached sessions produces correct structure | Sync message format |
| 4 | `processSyncResponse` merges missed messages into store correctly | Backfill merge logic |
| 5 | Health check state machine: healthy → degraded → down → recovery | State transitions |
| 6 | Reconnect delay calculation with jitter stays within expected bounds | Backoff math |

## Fake OpenCode Extensions

The fake server gains:

```typescript
// Toggleable health endpoint
fakeOpenCode.setHealthy(false);  // GET /global/health returns 503
fakeOpenCode.setHealthy(true);   // GET /global/health returns 200

// Session query for sync
fakeOpenCode.handle("GET", "/session/sess1/message", {
  status: 200,
  body: [
    { id: "msg1", role: "assistant", parts: [...], completed: true },
    { id: "msg2", role: "assistant", parts: [...], completed: false },
  ],
});
```

## Manual Smoke Test

After automated tests pass:

1. Start real OpenCode + daemon on dev machine
2. Start orchestrator (locally or on Railway)
3. Kill the daemon process mid-task → verify phone gets "daemon offline" push after 30s
4. Restart daemon → verify session resumes, no duplicate messages, push is cancelled
5. Kill OpenCode process → verify daemon detects within 90s, restarts it, sends status updates
6. Kill phone app, reopen → verify session history loads from cache immediately
7. Pair a fresh daemon instance using the 6-digit code flow

## Pass Criteria

All automated tests pass. No timeouts. Clean shutdown.
Phase 1 (19) + Phase 2 (9) + Phase 3 (28) + Phase 4 tests all pass together.
Manual smoke test passes.

## What We Explicitly Don't Test

- React Native UI (pairing screen, settings screen, verbosity toggle rendering)
- Actual `opencode serve` process spawning/management (requires real binary)
- Real network disruption (WiFi toggle) — simulated via WSS close
- Multi-user / RLS (deferred to Phase 5 or post-MVP)
- Load testing / performance benchmarks
- Real Expo push delivery
- Railway deployment specifics

## New Dependencies

- None expected. All new functionality uses existing packages (`ws`, `@supabase/supabase-js`,
  Node.js built-ins).

## Protocol Changes

`@mast/shared` protocol.ts gains four new message types:
- `SyncRequest` (orchestrator → daemon)
- `SyncResponse` (daemon → orchestrator)
- `PairRequest` (daemon → orchestrator, over WSS)
- `PairResponse` (orchestrator → daemon, over WSS)

The `OrchestratorMessage` union type expands to include `SyncRequest` and `PairResponse`.
The `DaemonMessage` union type expands to include `SyncResponse` and `PairRequest`.
