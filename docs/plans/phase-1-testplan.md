# Phase 1 Test Plan: Relay Layer

## What Phase 1 Does
Mobile phone → Orchestrator (HTTP) → Daemon (WSS) → OpenCode (HTTP on localhost).
Three packages: @mast/shared (types), @mast/orchestrator (cloud server), @mast/daemon (dev machine relay).

## Test Strategy

No mocking OpenCode. We use a **fake HTTP server** that impersonates OpenCode's API surface,
so we test the real relay chain end-to-end without depending on a running OpenCode instance.

Framework: `node:test` + `node:assert` (built-in, zero dependencies).

## Test Categories

### 1. Integration Tests (orchestrator + daemon + fake OpenCode)
These are the only tests that matter. They test the full relay chain.

| # | Test | What it proves |
|---|------|----------------|
| 1 | Health check shows `daemonConnected: false` before daemon connects | Orchestrator starts clean |
| 2 | Health check shows `daemonConnected: true` after daemon connects | WSS connection works |
| 3 | Unauthenticated request returns 401 | Auth middleware works |
| 4 | `GET /sessions` returns what fake OpenCode returns | GET relay works |
| 5 | `POST /sessions` with body forwards body to fake OpenCode | POST with body relay works |
| 6 | `GET /sessions/:id` with path params routes correctly | Path parameter forwarding works |
| 7 | `POST /sessions/:id/prompt` returns 204 for empty body | Empty response body handling works |
| 8 | Request when daemon disconnected returns 503 | Disconnection handling works |
| 9 | Daemon reconnects after disconnect | Reconnection logic works |
| 10 | Request timeout (daemon connected but never responds) returns 502 | Timeout handling works |
| 11 | Fake OpenCode returning 500 is relayed as 500 | Error status codes are preserved |
| 12 | Heartbeat is sent by daemon (observed on orchestrator side) | Keep-alive works |

### 2. Unit Tests (only where integration can't reach)

| # | Test | What it proves |
|---|------|----------------|
| 1 | `generateRequestId()` returns unique UUIDs | No collisions in request correlation |
| 2 | DaemonConnection rejects all pending on clearConnection() | No leaked promises on disconnect |
| 3 | DaemonConnection times out after configured timeout | Timeout math is correct |

## Test Architecture

```
┌─────────────┐     HTTP      ┌──────────────┐     WSS      ┌────────┐    HTTP    ┌──────────────┐
│  Test runner │ ──────────►  │ Orchestrator  │ ◄──────────► │ Daemon │ ────────►  │ Fake OpenCode│
│  (curl-like) │              │  (port A)     │              │        │            │  (port C)    │
└─────────────┘               └──────────────┘               └────────┘            └──────────────┘
```

- **Fake OpenCode**: Minimal HTTP server with programmable responses per path.
  Lets us control exactly what the relay sees.
- Orchestrator and Daemon run on ephemeral ports (port 0) to avoid conflicts.
- Each test file spins up the full stack, runs tests, tears down.

## Pass Criteria
All tests pass. No timeouts. Clean shutdown (no dangling handles).

## What We Explicitly Don't Test
- OpenCode's actual behavior (not our code)
- Mobile client (doesn't exist yet)
- Real WSS over internet (Phase 1 is localhost only)
- Performance/load (premature)
