# Phase 2 Test Plan: Basic Mobile Chat (Server-Side Streaming)

## What Phase 2 Does
Phone sends a message via HTTP POST. Agent responds. Response streams back as events:
OpenCode SSE → Daemon → WSS → Orchestrator → Phone WSS.

Three additions to the server-side code:
1. **Orchestrator:** New WSS endpoint for phone clients (`/ws`), forwards events from daemon to connected phones
2. **Daemon:** SSE subscription to OpenCode's `/event` stream, wraps events, sends over WSS
3. **Mobile client:** Expo project, chat screen — **not tested here** (React Native is a separate concern)

## Test Strategy

Same as Phase 1: **fake OpenCode server** extended with a programmable SSE endpoint.
Framework: `node:test` + `node:assert` (zero dependencies).

The fake OpenCode now supports:
- Existing HTTP request/response handlers (from Phase 1)
- A new SSE endpoint (`GET /event`) that emits events we push into it from the test

## Test Architecture

```
                                    ┌───────────┐
                                    │  Phone WS │ ◄──── events
                                    │ (test WS  │
                                    │  client)  │
                                    └─────┬─────┘
                                          │ WSS
┌─────────────┐     HTTP      ┌───────────┴────┐     WSS      ┌────────┐    HTTP+SSE  ┌──────────────┐
│  Test runner │ ──────────►  │  Orchestrator   │ ◄──────────► │ Daemon │ ──────────►  │ Fake OpenCode│
│  (fetch)     │              │  (port A)       │              │        │              │  (port C)    │
└─────────────┘               └────────────────┘               └────────┘              └──────────────┘
```

Test runner acts as both:
- HTTP client (sending messages via the orchestrator API)
- WebSocket client (connecting to `/ws` to receive streamed events)

## Test Categories

### 1. Integration Tests

| # | Test | What it proves |
|---|------|----------------|
| 1 | Phone WSS connects to `/ws` with valid Bearer token | Phone auth works |
| 2 | Phone WSS rejected on `/ws` without valid token | Phone auth rejects unauthorized |
| 3 | Daemon subscribes to fake OpenCode SSE, receives events | SSE subscription works |
| 4 | SSE event from fake OpenCode arrives on phone WSS | Full event relay chain works |
| 5 | Multiple SSE events arrive in order | Event ordering preserved |
| 6 | Phone sends message via HTTP, fake OpenCode emits SSE events, events arrive on phone WSS | Complete send+stream loop |
| 7 | Events still forwarded even if no phone is connected (no crash) | Graceful no-consumer handling |
| 8 | Phone disconnects and reconnects, receives new events | Reconnection works |
| 9 | Phase 1 relay still works (regression) | Streaming additions don't break request/response relay |

### 2. Unit Tests

| # | Test | What it proves |
|---|------|----------------|
| 1 | SSE event parsing handles `data:` prefixed lines correctly | Parser correctness |
| 2 | Event message wrapping produces correct DaemonMessage format | Protocol conformance |

## Fake OpenCode SSE Extension

The fake OpenCode server gains a new capability:

```typescript
// Programmable SSE endpoint
fakeOpenCode.pushEvent({ type: "message.part.updated", data: { ... } });
// This emits to any clients connected to GET /event
```

Implementation: maintain a list of connected SSE response streams. `pushEvent()` writes
`data: JSON.stringify(event)\n\n` to all connected streams.

## Pass Criteria
All tests pass. No timeouts. Clean shutdown (no dangling handles or open SSE connections).
Phase 1 tests still pass (regression).

## What We Explicitly Don't Test
- React Native UI (separate framework, manual testing for Phase 2)
- Actual OpenCode behavior
- Push notifications (Phase 3)
- Multiple simultaneous sessions (Phase 3)
- Permission approval flow (Phase 3)
