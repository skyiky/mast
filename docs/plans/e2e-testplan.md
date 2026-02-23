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

## Stage 6: Session Config, Settings, UI Features & Push

**Goal:** Test all the features built in UI Polish Rounds 1-2 and the Session Config Sheet,
Settings screen, session management, and push notifications on a real device.

**Prerequisites:**
- Stages 0-5 pass (app runs, pairing works, core E2E works, resilience + Supabase verified)
- At least one session with messages already exists (from Stage 3)
- Daemon running with OpenCode (not `MAST_SKIP_OPENCODE`)

---

### Test 6.1: Session Config Sheet — Open & Info

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a session with messages | Chat screen renders with messages |
| 2 | Tap the `⋮` button in the header | Bottom sheet slides up from bottom |
| 3 | Observe `// session` section | Shows: status (idle/working), project path (shortened), created time (e.g. "2h ago"), message count |
| 4 | Swipe sheet up | Sheet expands to 90% snap point |
| 5 | Swipe sheet down past close threshold | Sheet dismisses, backdrop disappears |

**Pass criteria:** Sheet opens/closes smoothly, session info is accurate, backdrop is
semi-transparent and tappable to close.

### Test 6.2: Session Config — Verbosity & Mode Toggles

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open config sheet | Sheet opens |
| 2 | In `// controls`, tap "full" under verbosity | Toggle highlights "full", haptic feedback |
| 3 | Tap "std" | Toggle switches back to "std", haptic feedback |
| 4 | Tap "plan" under mode | Toggle highlights "plan", haptic feedback |
| 5 | Close sheet, send a prompt | If plan mode works: prompt should be prefixed with "PLAN MODE:" (verify in daemon logs) |
| 6 | Re-open sheet, tap "build" | Mode switches back to "build" |

**Pass criteria:** Toggles work, persist across sheet open/close, and plan mode affects prompts.

### Test 6.3: Session Config — Model Selector

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open config sheet | Sheet opens |
| 2 | Tap the "model" row | Dropdown expands with provider groups |
| 3 | Observe provider grouping | Models grouped by provider (e.g. `// github-copilot`), count shown |
| 4 | Observe default markers | Default model for each provider marked with ` *` |
| 5 | Tap a different model | Model selects (highlight + haptic), dropdown closes |
| 6 | Verify selected model shown | Model row now shows the new model name |

**Pass criteria:** Model list loads from `/providers` API, grouped correctly, selection works.
Note: changing the model in the UI does NOT currently change what OpenCode uses — this is
a display-only feature for Phase 1.

### Test 6.4: Session Config — View Diff

| Step | Action | Expected |
|------|--------|----------|
| 1 | In a session where the agent has modified files, open config sheet | Sheet opens |
| 2 | Tap "view diff" in `// inspect` section | DiffSheet modal opens full-screen |
| 3 | Observe diff content | File paths, additions/deletions counts, patch content visible |
| 4 | Scroll through diff | Long diffs scroll smoothly |
| 5 | Close diff (tap close / swipe) | Returns to config sheet |

**Pass criteria:** Diff loads from `/sessions/:id/diff` API, renders correctly.
If no files were changed, diff should show an empty state or "no changes" message.

### Test 6.5: Session Config — Abort Execution

| Step | Action | Expected |
|------|--------|----------|
| 1 | Send a complex prompt that takes a while (e.g. "Refactor all files to use camelCase") | Agent starts working, status shows "working" |
| 2 | Quickly open config sheet | Sheet opens |
| 3 | Observe `[abort execution]` button | Button is red (enabled, since agent is streaming) |
| 4 | Tap `[abort execution]` | Haptic warning, spinner shows, agent stops |
| 5 | Verify status returns to idle | Status dot changes to green "idle" |

**Pass criteria:** Abort stops the agent mid-execution. When agent is idle, the abort button
should be dimmed/disabled.

### Test 6.6: Session Config — Revert Last Response

| Step | Action | Expected |
|------|--------|----------|
| 1 | In a session with at least one exchange, open config sheet | Sheet opens |
| 2 | Tap `[revert last response]` | Confirmation alert appears: "revert last response" |
| 3 | Tap "revert" in the alert | Loading spinner, then sheet closes |
| 4 | Observe chat | Both the last assistant message AND the user prompt that triggered it are removed |
| 5 | Observe text input | Pre-filled with the reverted user prompt text |
| 6 | (Optional) Re-send the pre-filled prompt | Agent processes it again as a new message |

**Pass criteria:** Revert removes both messages, pre-fills input, and the API call to
`/sessions/:id/revert` succeeds. When no messages exist, the button should be dimmed.

### Test 6.7: Settings Screen

| Step | Action | Expected |
|------|--------|----------|
| 1 | From session list, tap the gear icon in the header | Settings screen opens with fade transition |
| 2 | Observe `// connection` section | Shows server URL, connection statuses (WebSocket, daemon, OpenCode) with green/red dots |
| 3 | Long-press server URL | URL popup appears with copy option |
| 4 | Tap "copy" | URL copied to clipboard, checkmark confirmation |
| 5 | Observe `// preferences` section | Verbosity toggle (std/full) visible |
| 6 | Toggle verbosity | Toggle switches, haptic feedback, persists after leaving and returning |
| 7 | Tap `[re-pair device]` | Confirmation alert: "this will disconnect..." |
| 8 | Tap "cancel" | Alert dismisses, stays on settings |
| 9 | (Do NOT actually re-pair unless you want to redo Stage 2) | |

**Pass criteria:** Settings screen shows accurate connection info, verbosity toggle works
and persists (AsyncStorage), re-pair flow has confirmation gate.

### Test 6.8: Session List — Day Grouping & Enhanced Cards

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure multiple sessions exist (create 2-3 if needed) | Session list has multiple entries |
| 2 | Observe day headers | Sessions grouped under headers like "today", "yesterday", or date strings |
| 3 | Observe session cards | Each card shows: session title/slug, last user message preview, timestamp |
| 4 | Verify preview text | Preview shows the actual last USER message (truncated), NOT an AI-generated description |

**Pass criteria:** Day grouping renders correctly, session cards show real user message
previews, timestamps are accurate.

### Test 6.9: Session List — Long-Press Delete

| Step | Action | Expected |
|------|--------|----------|
| 1 | Long-press on a session card | Confirmation alert: delete session? |
| 2 | Tap "cancel" | Alert dismisses, session remains |
| 3 | Long-press again, tap "delete" | Session removed from list with animation |
| 4 | Pull-to-refresh | Deleted session does not reappear |

**Pass criteria:** Long-press triggers delete flow, confirmation gate works, deletion
persists across refresh.

### Test 6.10: Chat — Empty State

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a new session | Navigates to chat screen |
| 2 | Observe empty chat area | Empty state component renders (not just blank white/black) |
| 3 | Send a message | Empty state disappears, message appears |

**Pass criteria:** New sessions show a helpful empty state, not a blank screen.

### Test 6.11: Chat — Pull-to-Refresh

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a session with messages | Chat screen with messages |
| 2 | Pull down on the message list | Refresh indicator appears |
| 3 | Wait for refresh | Messages reload from API, indicator disappears |
| 4 | Verify no duplicate messages | Same messages as before, no duplicates |

**Pass criteria:** Pull-to-refresh reloads messages without duplicates or visual glitches.

### Test 6.12: Screen Transitions (Fade)

| Step | Action | Expected |
|------|--------|----------|
| 1 | From session list, tap a session | Fade transition to chat screen (not slide) |
| 2 | Tap back | Fade transition back to session list |
| 3 | Tap gear icon | Fade transition to settings |
| 4 | Tap back | Fade transition back |

**Pass criteria:** All screen transitions use fade animation (~200ms), not the default
slide-from-right.

### Test 6.13: Tool Call Card — Expand/Collapse

| Step | Action | Expected |
|------|--------|----------|
| 1 | Find a message with tool invocations (e.g. file reads) | Tool cards visible |
| 2 | Observe collapsed tool card | Shows tool name and truncated result (max ~500 chars) |
| 3 | Tap `[show more]` | Result expands to full content |
| 4 | Tap `[show less]` | Result collapses back |

**Pass criteria:** Long tool results are truncated by default with expand/collapse toggle.
Short results show in full without toggle.

### Test 6.14: Push Notifications (Background)

**Note:** This test requires a development build or EAS build — push tokens may not work
in Expo Go. If push registration fails silently, skip this test.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Verify push token registered | Check daemon/orchestrator logs for push token registration |
| 2 | Background the Mast app (swipe home) | App goes to background |
| 3 | From another terminal, send a prompt to the session via curl or daemon | Agent starts working |
| 4 | Wait for agent to request a permission | Push notification appears on phone |
| 5 | Tap the notification | App opens to the relevant session |

**Pass criteria:** Push notification received when app is backgrounded. Tapping notification
navigates to the correct session. If push tokens don't work in Expo Go, this test is
deferred to EAS build.

### Test 6.15: Connection Banner States

| Step | Action | Expected |
|------|--------|----------|
| 1 | With everything connected, observe top of screen | No connection banner visible |
| 2 | Kill the daemon | Banner appears: "agent offline" or similar warning |
| 3 | Restart daemon | Banner disappears within ~5 seconds |
| 4 | (Optional) Toggle airplane mode briefly | Banner shows WebSocket disconnection, then recovers |

**Pass criteria:** Connection banner accurately reflects system state, appears/disappears
reactively.

### Test 6.16: Dark/Light Theme

| Step | Action | Expected |
|------|--------|----------|
| 1 | Set iPhone to dark mode (Settings → Display) | App uses OLED dark theme (pure black bg) |
| 2 | Check all screens: session list, chat, settings, config sheet | All screens use dark colors, no white-on-white |
| 3 | Set iPhone to light mode | App switches to light theme |
| 4 | Check all screens again | Light backgrounds, dark text, no black-on-black |
| 5 | Check accent color | Blue accent (#5c7cfa) visible on buttons and highlights in both modes |

**Pass criteria:** Theme follows system setting, all screens render correctly in both modes,
no hardcoded colors causing contrast issues.

---

## Pass / Fail Summary

| Stage | Tests | Pass | Fail | Notes |
|-------|-------|------|------|-------|
| 0. Pre-flight fixes | 3 | | | Must all pass before proceeding |
| 1. Mobile smoke | 5 | | | Expo Go on iPhone |
| 2. Pairing flow | 4 | | | Daemon + Azure + Phone |
| 3. Core E2E | 8 | | | Full relay chain with OpenCode |
| 4. Resilience | 4 | | | Disconnect/reconnect scenarios |
| 5. Supabase | 2 | | | Data persistence verification |
| 6. Config, Settings, UI & Push | 16 | | | Session config, settings, UI polish, push |
| **Total** | **42** | | | |
