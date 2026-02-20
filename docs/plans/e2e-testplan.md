# End-to-End Test Plan: Full Stack Verification

## Purpose

All 5 phases are built, committed, and individually tested with automated tests (110 total).
Infrastructure is deployed (Azure Container Apps + Supabase). But no test has yet exercised
the full chain: **Phone → Orchestrator (Azure) → Daemon → OpenCode** with real data flowing
through real networks.

This plan covers three stages:
1. **Pre-flight fixes** — bugs found during code review that must be fixed before testing
2. **Mobile app smoke test** — does the Expo app build, render, and navigate on a real device
3. **Full E2E integration** — complete workflows across all four components

## Architecture Reminder

```
iPhone (Expo Go)                    Azure Container Apps              Dev Machine (Windows)
┌──────────────┐    HTTPS/WSS     ┌─────────────────┐    WSS       ┌──────────────────┐
│  Mast Mobile ├──────────────────┤  Orchestrator    ├─────────────┤  Daemon           │
│  (React      │                  │  (Hono + ws)     │             │  (Node.js)        │
│   Native)    │                  │                  │             │       │            │
└──────────────┘                  │  Supabase ←──────┤             │       ▼            │
                                  └─────────────────┘             │  OpenCode          │
                                                                   │  (localhost:4096)  │
                                                                   └──────────────────┘
```

Live URLs:
- Orchestrator: `https://your-orchestrator.azurecontainerapps.io`
- Supabase: `https://your-project-ref.supabase.co`

---

## Stage 0: Pre-Flight Fixes

Bugs and issues found during code review that will block E2E testing.

### Fix 0.1: Pairing Request Body Field Mismatch

**Bug:** The mobile app sends `{ pairingCode: code }` but the orchestrator expects `{ code: string }`.

- `packages/mobile/src/lib/api.ts:114` sends `{ pairingCode: code }`
- `packages/orchestrator/src/routes.ts:236` types the body as `{ code?: string }`
- `packages/orchestrator/src/routes.ts:242` checks `if (!body.code)`

Result: pairing from the phone always fails with `"Missing code"`.

**Fix:** Change `api.ts:114` from `{ pairingCode: code }` to `{ code }`.

### Fix 0.2: Placeholder URL in Pairing Screen

**Cosmetic:** `packages/mobile/app/pair.tsx:200` has placeholder text
`"https://your-server.railway.app"` — should say `"https://your-server.azurecontainerapps.io"`.

### Fix 0.3: Verify `supabase/.temp/` is Gitignored

The `supabase/.temp/` directory appears in `git status` as untracked. Should be added to
`.gitignore` to keep the working tree clean.

---

## Stage 1: Mobile App Smoke Test (Expo Go)

**Goal:** Verify the React Native app builds via Metro, renders on a physical iPhone, and
all screens are navigable.

**Prerequisites:**
- iPhone with Expo Go installed (same WiFi network as dev machine)
- Stage 0 fixes applied
- `npm install` completed at repo root

**How to start:**
```bash
cd packages/mobile
npx expo start
```
Scan the QR code from the terminal with the iPhone camera → opens in Expo Go.

### Test 1.1: App Launches Without Crash

| Step | Action | Expected |
|------|--------|----------|
| 1 | Scan QR with iPhone | Expo Go opens, Metro bundles JS |
| 2 | Wait for bundle | App loads without red error screen |
| 3 | Observe initial screen | Pairing screen shown (since `paired` is false and `serverUrl` is empty) |

**Pass criteria:** No crash, no red screen, pairing screen renders with "Pair Your Device"
title, QR scanner / manual code toggle visible.

### Test 1.2: Pairing Screen — Manual Mode

| Step | Action | Expected |
|------|--------|----------|
| 1 | Tap "Enter Code" tab | Switches to manual entry mode |
| 2 | Observe UI | Server URL text input visible, 6-digit code input below |
| 3 | Enter URL: `https://your-orchestrator.azurecontainerapps.io` | URL field populated |
| 4 | Enter any 6 digits (no daemon running) | Loading spinner, then "Connection failed" or "Pairing failed" error |

**Pass criteria:** Mode toggle works, inputs accept text, error state renders correctly
(red banner). No crash.

### Test 1.3: Pairing Screen — QR Mode

| Step | Action | Expected |
|------|--------|----------|
| 1 | Tap "Scan QR" tab (if not already active) | Camera viewfinder appears (after granting permission) |
| 2 | Grant camera permission if prompted | Camera feed visible in rounded rectangle |
| 3 | Point at a non-Mast QR code | "Invalid QR code format" error |

**Pass criteria:** Camera permission flow works, viewfinder renders, invalid QR handled
gracefully.

### Test 1.4: Settings Screen (via direct navigation)

The settings screen is normally accessible from the session list (which requires pairing).
For this test, temporarily hardcode `paired: true` and `serverUrl` in the connection store
defaults to bypass the pairing redirect, then test navigation.

Alternatively, complete the full pairing first (Stage 2) and then test settings.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to settings (gear icon on session list) | Settings screen renders |
| 2 | Observe connection status section | Shows server URL, daemon status, OpenCode status |
| 3 | Toggle theme (if implemented) | Dark/light mode switches |
| 4 | Tap "Re-pair" | Navigates back to pairing screen |

### Test 1.5: NativeWind Styling

| Step | Action | Expected |
|------|--------|----------|
| 1 | Check dark mode (phone in dark mode) | Dark backgrounds, light text throughout |
| 2 | Check light mode (phone in light mode) | Light backgrounds, dark text throughout |
| 3 | Check mast-600 brand color | Blue accent color (#5c7cfa) on buttons and highlights |

**Pass criteria:** Tailwind classes are compiled and applied. No unstyled raw text or
white-on-white / black-on-black issues.

---

## Stage 2: Pairing Flow (Full Stack)

**Goal:** Pair the phone with a daemon running on the dev machine, via the live Azure
orchestrator.

**Prerequisites:**
- Stage 1 passes (app renders on phone)
- Azure orchestrator is running and healthy
- Delete existing device key to force re-pairing: `del C:\Users\davidzhang\.mast\device-key.json`

**Components running:**
1. Orchestrator — already running on Azure
2. Daemon — started locally on dev machine
3. Mobile — running in Expo Go on iPhone

### Test 2.1: Daemon Starts and Enters Pairing Mode

```bash
cd packages/daemon
MAST_ORCHESTRATOR_URL=wss://your-orchestrator.azurecontainerapps.io \
MAST_SKIP_OPENCODE=1 \
npx tsx src/index.ts
```

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start daemon without device key | "No device key found — starting pairing flow" logged |
| 2 | Daemon connects to orchestrator | 6-digit code displayed in terminal |
| 3 | QR code displayed | Terminal shows QR code (may be garbled on Windows, fine to ignore) |

**Pass criteria:** Daemon connects to Azure, generates pairing code, displays it. No crash.

### Test 2.2: Phone Pairs via Manual Code Entry

| Step | Action | Expected |
|------|--------|----------|
| 1 | On phone, enter orchestrator URL in manual mode | URL accepted |
| 2 | Enter the 6-digit code shown in daemon terminal | Loading spinner |
| 3 | Wait for response | "Pairing successful" — phone redirects to session list |
| 4 | Check daemon terminal | "Pairing successful!" logged, device key saved |
| 5 | Check file system | `~/.mast/device-key.json` created with `dk_<uuid>` |

**Pass criteria:** Pairing completes, phone shows session list (empty, since no daemon
session relay yet). Daemon has a device key and will reconnect as authenticated.

### Test 2.3: Phone Pairs via QR Code

Same as 2.2, but instead of manual code entry:

| Step | Action | Expected |
|------|--------|----------|
| 1 | Point iPhone camera at QR code in daemon terminal | QR scanned, haptic feedback |
| 2 | Auto-fills URL and code | Pairing proceeds automatically |
| 3 | Phone redirects to session list | Same as 2.2 |

**Note:** QR terminal output may not work on Windows. If QR is unreadable, skip this test
(manual entry is the primary flow for Phase 1 dogfood).

### Test 2.4: Daemon Reconnects as Authenticated

After pairing completes, the daemon should automatically disconnect the pairing socket and
reconnect with the new device key.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Watch daemon logs after pairing | "Connecting to orchestrator..." with device key |
| 2 | Hit health endpoint | `curl https://mast-orchestrator.../health` shows `"daemonConnected": true` |
| 3 | Check phone connection banner | No "daemon disconnected" warning |

---

## Stage 3: Core E2E Workflows (With OpenCode)

**Goal:** Test the complete relay chain with a real OpenCode instance processing real prompts.

**Prerequisites:**
- Stage 2 passes (phone paired, daemon connected)
- OpenCode installed and configured on dev machine
- A test git repo to work in (e.g., a scratch directory with a simple project)

**Components running:**
1. Orchestrator — Azure
2. Daemon — local, with OpenCode (not `MAST_SKIP_OPENCODE`)
3. Mobile — Expo Go on iPhone, paired

### Start command (daemon with real OpenCode):

```bash
cd /path/to/test-repo
MAST_ORCHESTRATOR_URL=wss://your-orchestrator.azurecontainerapps.io \
npx tsx /path/to/mast/packages/daemon/src/index.ts
```

### Test 3.1: Health Check — All Green

| Step | Action | Expected |
|------|--------|----------|
| 1 | Wait for daemon to start + OpenCode to be ready | Daemon logs "OpenCode is ready" |
| 2 | Phone: pull-to-refresh on session list | No error, list loads (empty or with prior sessions) |
| 3 | Phone: check connection banner | No warning banner (all systems connected) |
| 4 | `curl .../health` | `{"status":"ok","daemonConnected":true,"phonesConnected":1}` |

### Test 3.2: Create Session

| Step | Action | Expected |
|------|--------|----------|
| 1 | Phone: tap "New Session" button | Loading spinner briefly |
| 2 | Wait | Navigates to chat screen |
| 3 | Observe chat screen | Empty message list, text input at bottom, session ID in header |

**Verify relay chain:** This test proves: Phone → HTTP POST /sessions → Orchestrator →
WSS http_request → Daemon → HTTP POST /session to OpenCode → response relayed back.

### Test 3.3: Send Prompt — Simple Response

| Step | Action | Expected |
|------|--------|----------|
| 1 | Phone: type "What files are in this directory?" in chat input | Text appears in input |
| 2 | Phone: tap send (arrow button) | Haptic feedback, user message appears as bubble |
| 3 | Wait for agent response (5-30 seconds) | Assistant message appears, text streams in progressively |
| 4 | Wait for completion | Streaming indicator stops, full response visible |

**What's being tested:**
- Phone → POST /sessions/:id/prompt → Orchestrator → WSS → Daemon → POST /session/:id/prompt_async to OpenCode
- OpenCode SSE events → Daemon SSE client → WSS event to Orchestrator → WSS broadcast to Phone
- Phone WebSocket event handler → Zustand store → React re-render
- Message parts: text content streaming via `message.part.updated` events
- `message.completed` event marks message as done

### Test 3.4: Send Prompt — Tool Invocation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Phone: send "Read the contents of package.json" | User message appears |
| 2 | Wait for response | Assistant requests file read permission (OR auto-approved if configured) |
| 3 | If permission required: see Test 3.5 | Permission card appears |
| 4 | Response streams in with file content | Text renders correctly, potentially with markdown code blocks |

**What's being tested:**
- Tool invocation events from OpenCode
- Markdown rendering in `MarkdownContent` component

### Test 3.5: Permission Approval

| Step | Action | Expected |
|------|--------|----------|
| 1 | Agent requests a permission (file write, shell command, etc.) | PermissionCard appears with description |
| 2 | Phone: tap "Approve" | Haptic feedback, card updates to approved state |
| 3 | Wait | Agent continues executing, new messages stream in |

**Verify relay chain:** Phone → POST /sessions/:id/approve/:pid → Orchestrator → WSS →
Daemon → POST /session/:id/permissions/:pid `{ approve: true }` → OpenCode.

### Test 3.6: Permission Denial

| Step | Action | Expected |
|------|--------|----------|
| 1 | Agent requests a permission | PermissionCard appears |
| 2 | Phone: tap "Deny" | Haptic feedback, card updates to denied state |
| 3 | Wait | Agent acknowledges denial, adjusts behavior |

### Test 3.7: Multiple Messages in a Session

| Step | Action | Expected |
|------|--------|----------|
| 1 | Send 3-4 follow-up prompts in the same session | Each user message + agent response appears |
| 2 | Scroll up | Previous messages visible and correctly ordered |
| 3 | Auto-scroll on new message | List scrolls to bottom when new content arrives |

### Test 3.8: Session List After Activity

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate back to session list | Session appears in list |
| 2 | Pull to refresh | Session list refreshes, shows updated timestamp |
| 3 | Tap on session | Re-enters chat, messages loaded from API/cache |

---

## Stage 4: Resilience & Edge Cases

### Test 4.1: Daemon Disconnect / Reconnect

| Step | Action | Expected |
|------|--------|----------|
| 1 | Kill daemon process (Ctrl+C) | |
| 2 | Phone: observe connection banner | "Agent offline" or similar warning appears |
| 3 | Phone: try to send a prompt | Returns 503 error or shows "daemon not connected" |
| 4 | Restart daemon | |
| 5 | Wait ~5 seconds | Connection banner disappears, daemon reconnected |
| 6 | Send a prompt | Works normally |

### Test 4.2: Phone Reconnect

| Step | Action | Expected |
|------|--------|----------|
| 1 | Toggle airplane mode on iPhone (brief) | WebSocket disconnects |
| 2 | Turn off airplane mode | WebSocket reconnects after ~2 seconds |
| 3 | Send a prompt | Works normally |

### Test 4.3: Cached Sessions (Daemon Offline)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a session and exchange some messages | Session + messages in Supabase |
| 2 | Kill daemon | |
| 3 | Phone: view session list | Sessions still load (from Supabase cache) |
| 4 | Phone: open a session | Messages load from cache |
| 5 | Phone: try to send prompt | Fails with "daemon not connected" |

### Test 4.4: Daemon Restart with Existing Device Key

| Step | Action | Expected |
|------|--------|----------|
| 1 | Stop daemon | |
| 2 | Restart daemon | "Loaded device key from ~/.mast/device-key.json" logged |
| 3 | No pairing flow | Daemon connects directly, no pairing code displayed |
| 4 | Health check | daemonConnected: true |

---

## Stage 5: Supabase Persistence Verification

### Test 5.1: Data in Supabase After E2E

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open Supabase dashboard → Table Editor | |
| 2 | Check `sessions` table | Session rows with IDs matching what the phone created |
| 3 | Check `messages` table | Messages with correct roles, parts (JSONB), session_id FK |
| 4 | Verify message parts | JSONB contains `[{"type":"text","content":"..."}]` |

### Test 5.2: Orchestrator Restart Preserves State

| Step | Action | Expected |
|------|--------|----------|
| 1 | Note current sessions and messages | |
| 2 | Redeploy orchestrator: `make deploy VERSION=v2` | |
| 3 | Wait for container to start | |
| 4 | Phone: open session list | Same sessions visible (loaded from Supabase) |
| 5 | Phone: open a session | Previous messages visible |

---

## Quick Reference: Startup Commands

```bash
# Terminal 1 — Daemon (with OpenCode)
cd /path/to/test-repo
MAST_ORCHESTRATOR_URL=wss://your-orchestrator.azurecontainerapps.io \
npx tsx E:/dev/mast/packages/daemon/src/index.ts

# Terminal 2 — Daemon (without OpenCode, for pairing/network tests only)
MAST_ORCHESTRATOR_URL=wss://your-orchestrator.azurecontainerapps.io \
MAST_SKIP_OPENCODE=1 \
npx tsx packages/daemon/src/index.ts

# Terminal 3 — Mobile (Expo dev server)
cd packages/mobile
npx expo start

# One-liner health check
curl https://your-orchestrator.azurecontainerapps.io/health

# Tail Azure logs
make logs
```

## Pass / Fail Summary

| Stage | Tests | Pass | Fail | Notes |
|-------|-------|------|------|-------|
| 0. Pre-flight fixes | 3 | | | Must all pass before proceeding |
| 1. Mobile smoke | 5 | | | Expo Go on iPhone |
| 2. Pairing flow | 4 | | | Daemon + Azure + Phone |
| 3. Core E2E | 8 | | | Full relay chain with OpenCode |
| 4. Resilience | 4 | | | Disconnect/reconnect scenarios |
| 5. Supabase | 2 | | | Data persistence verification |
| **Total** | **26** | | | |
