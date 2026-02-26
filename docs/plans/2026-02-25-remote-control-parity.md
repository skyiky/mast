# Remote Control Feature Parity — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 7 feature gaps between Mast and Claude Code Remote Control.

**Architecture:** 7 features across 5 phases. Phase 1 starts with the smallest win (MCP metadata) and the largest investment (web client) in parallel. Phase 2 builds the CLI foundation. Phases 3-5 layer features that depend on earlier phases.

**Tech Stack:** Vite + React + Zustand (web), esbuild (CLI bundling), Node.js (daemon enhancements), existing Hono + ws + Expo stack.

---

## Phase 1 — Parallel, no dependencies

### Feature 4: MCP Server Passthrough

MCP tools already flow through the relay — when OpenCode invokes an MCP tool, it appears as a `tool-invocation` part in the SSE stream and is rendered by `ToolCallCard` in the mobile UI. The permission system already gates them.

The actual gap is **visibility**: users can't see which MCP servers are configured or their status.

#### Task 4.1: Probe OpenCode for MCP server info

**Files:**
- Test manually against a running OpenCode instance

**Step 1:** Start OpenCode with an MCP server configured and check what endpoints expose MCP info:
```bash
curl http://localhost:4096/global/health
curl http://localhost:4096/mcp
curl http://localhost:4096/config
```

**Step 2:** Document which endpoint (if any) returns MCP server metadata. If none exists, we'll need to read the project's `.opencode/config.json` directly from the daemon.

#### Task 4.2: Add MCP server list endpoint to orchestrator routes

**Files:**
- Modify: `packages/orchestrator/src/routes.ts`

**Step 1:** Add a route that forwards to the daemon:
```typescript
app.get("/mcp-servers", async (c) => {
  const userId = c.get("userId");
  const daemon = getDaemon(userId);
  const result = await forward(daemon, "GET", "/mcp-servers");
  return c.json(result.body as object, result.status as 200);
});
```

**Step 2:** In the daemon relay, handle `/mcp-servers` by reading OpenCode's config or querying its API.

#### Task 4.3: Surface MCP server info in mobile settings

**Files:**
- Modify: `packages/mobile/app/settings.tsx`
- Modify: `packages/mobile/src/lib/api.ts`

Add an "MCP Servers" section to the settings screen showing server names and connection status.

#### Task 4.4: Document that MCP passthrough works

**Files:**
- Modify: `docs/ROADMAP.md`

Update the roadmap entry to reflect that MCP tool calls already work, and the feature is about metadata visibility.

---

### Feature 1: Web Browser Client

A React SPA at `packages/web` that mirrors the mobile app's capabilities.

#### Task 1.1: Scaffold packages/web

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/tailwind.config.js`
- Create: `packages/web/postcss.config.js`

**Step 1:** Initialize the package:
```bash
cd packages/web
npm init -y
npm install react react-dom zustand @supabase/supabase-js
npm install -D vite @vitejs/plugin-react typescript tailwindcss postcss autoprefixer @types/react @types/react-dom
npx tailwindcss init -p
```

**Step 2:** Configure Vite with React plugin, path aliases, and proxy to orchestrator for dev.

**Step 3:** Add to workspace root `package.json` (already covered by `"workspaces": ["packages/*"]`).

**Step 4:** Verify `npm run dev --workspace=packages/web` starts Vite dev server.

#### Task 1.2: Port framework-agnostic logic from mobile

**Files:**
- Create: `packages/web/src/lib/api.ts` (copy from mobile, remove React Native imports)
- Create: `packages/web/src/lib/event-handler.ts` (copy verbatim — zero RN deps)
- Create: `packages/web/src/lib/supabase.ts` (browser version)

The mobile `api.ts` and `event-handler.ts` have zero React Native dependencies — they use `fetch` and plain objects. Copy them directly.

For Supabase, create a browser client using `createClient` with `localStorage` for persistence.

#### Task 1.3: Create Zustand stores

**Files:**
- Create: `packages/web/src/stores/connection.ts`
- Create: `packages/web/src/stores/sessions.ts`
- Create: `packages/web/src/stores/settings.ts`

Mirror the mobile stores but use `localStorage` instead of `AsyncStorage` for persistence. The store shapes and actions are identical.

#### Task 1.4: Build WebSocket hook

**Files:**
- Create: `packages/web/src/hooks/useWebSocket.ts`

Use native browser `WebSocket`. Same reconnect logic as mobile (2s delay, resetEventDedup on connect, markAllStreamsComplete on disconnect). No `ws` package needed.

#### Task 1.5: Build auth flow

**Files:**
- Create: `packages/web/src/pages/Login.tsx`

Supabase GitHub OAuth with browser redirect flow:
```typescript
const { error } = await supabase.auth.signInWithOAuth({
  provider: "github",
  options: { redirectTo: window.location.origin },
});
```

On return, Supabase auto-parses the hash fragment and sets the session.

#### Task 1.6: Build session list page

**Files:**
- Create: `packages/web/src/pages/SessionList.tsx`
- Create: `packages/web/src/components/SessionRow.tsx`
- Create: `packages/web/src/components/ProjectFilterBar.tsx`

Session list with project filter chips, session previews, and a "New Session" button. Pull-to-refresh equivalent: just a refresh button or auto-refresh on focus.

#### Task 1.7: Build chat page

**Files:**
- Create: `packages/web/src/pages/Chat.tsx`
- Create: `packages/web/src/components/MessageBubble.tsx`
- Create: `packages/web/src/components/PermissionCard.tsx`
- Create: `packages/web/src/components/ToolCallCard.tsx`
- Create: `packages/web/src/components/MarkdownContent.tsx`

Chat interface with streaming messages, permission approve/deny cards, tool call cards, and markdown rendering. Use `react-markdown` + `remark-gfm` for markdown.

#### Task 1.8: Build diff viewer

**Files:**
- Create: `packages/web/src/components/DiffViewer.tsx`

Use `react-diff-viewer-continued` or a lightweight diff component. Fetch diff via `GET /sessions/:id/diff`.

#### Task 1.9: Build settings page

**Files:**
- Create: `packages/web/src/pages/Settings.tsx`

Connection status, project list, theme toggle (dark/light), pairing status.

#### Task 1.10: Add routing

**Files:**
- Modify: `packages/web/src/App.tsx`

Use `react-router-dom` for client-side routing:
- `/login` → Login
- `/` → SessionList (redirect to /login if not authed)
- `/chat/:id` → Chat
- `/settings` → Settings

#### Task 1.11: Add orchestrator static serving

**Files:**
- Modify: `packages/orchestrator/src/server.ts`
- Modify: `packages/orchestrator/package.json`

Serve the built web client from `./web-dist` if the directory exists:
```typescript
import { serveStatic } from "@hono/node-server/serve-static";
app.use("/*", serveStatic({ root: "./web-dist" }));
```

Add a build script that copies `packages/web/dist` → `packages/orchestrator/web-dist`.

---

## Phase 2 — CLI Foundation

### Feature 2: Zero-Config Setup (`npx mast`)

#### Task 2.1: Scaffold packages/cli

**Files:**
- Create: `packages/cli/package.json` (with `"bin": { "mast": "./dist/cli.mjs" }`)
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/build.mjs` (esbuild script)

**Step 1:** Create the package with a `bin` field pointing to the bundled output.

**Step 2:** esbuild config that bundles `cli.ts` + daemon code into a single `dist/cli.mjs` file:
```javascript
import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/cli.mjs",
  external: ["qrcode"],
  banner: { js: "#!/usr/bin/env node" },
});
```

#### Task 2.2: Implement CLI argument parsing

**Files:**
- Modify: `packages/cli/src/cli.ts`

Use Node's built-in `parseArgs` (no external deps):
```
mast                        # auto-detect project, start daemon, show pairing
mast /path/to/project       # explicit project directory
mast --port 5000            # custom OpenCode port
mast --orchestrator wss://  # custom orchestrator URL
mast --sandbox              # enable sandbox mode (Feature 5)
mast attach <url>           # attach to running OpenCode (Feature 3)
mast daemon                 # long-running mode (Feature 6)
```

#### Task 2.3: Implement auto-detect and first-run

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Reuse: `packages/daemon/src/project-config.ts`
- Reuse: `packages/daemon/src/key-store.ts`

Flow:
1. If no `~/.mast/projects.json`, create it with `[{ name: basename(cwd), directory: cwd }]`
2. Start OpenCode process
3. Start relay connecting to orchestrator
4. If no `~/.mast/device-key.json`, initiate pairing (display code + QR)
5. Print status and wait

#### Task 2.4: Bundle and test npx

**Step 1:** `node build.mjs` → produces `dist/cli.mjs`
**Step 2:** `node dist/cli.mjs --help` → verify it works
**Step 3:** `npm pack --workspace=packages/cli` → verify tarball
**Step 4:** `npx ./packages/cli/mast-cli-0.0.1.tgz` → verify npx works

---

## Phase 3 — Depends on Phase 2

### Feature 3: Mid-Session Attach

#### Task 3.1: Implement port-scan discovery

**Files:**
- Create: `packages/daemon/src/discover.ts`
- Create: `packages/daemon/test/discover.test.ts`

```typescript
export async function discoverOpenCode(
  portRange: [number, number] = [4096, 4110],
): Promise<Array<{ url: string; port: number }>> {
  const found = [];
  for (let port = portRange[0]; port <= portRange[1]; port++) {
    try {
      const res = await fetch(`http://localhost:${port}/global/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) found.push({ url: `http://localhost:${port}`, port });
    } catch { /* not listening */ }
  }
  return found;
}
```

Test with `fake-opencode.ts` listening on a random port.

#### Task 3.2: Add unmanaged project mode to ProjectManager

**Files:**
- Modify: `packages/daemon/src/project-manager.ts`
- Create: `packages/daemon/test/unmanaged.test.ts`

Add `attachProject(name, url)` that creates SSE + health subscriptions without owning an `OpenCodeProcess`. The project is marked `managed: false` — no restart on crash, no SIGTERM on shutdown.

#### Task 3.3: Add `mast attach` CLI command

**Files:**
- Modify: `packages/cli/src/cli.ts`

`mast attach http://localhost:4096` — discover or explicitly connect to a running OpenCode. On connect, fetch all sessions + messages and sync to orchestrator.

#### Task 3.4: Session backfill on attach

**Files:**
- Modify: `packages/daemon/src/relay.ts`

After attaching, the relay fetches `GET /session` to list all sessions, then `GET /session/:id/message` for each, and sends a `sync_response` to the orchestrator with the full history.

---

### Feature 5: Sandboxing Mode

#### Task 5.1: Add sandbox flag to daemon config

**Files:**
- Modify: `packages/daemon/src/project-config.ts` — add `sandbox?: boolean` to `Project` type
- Modify: `packages/shared/src/protocol.ts` — add `sandboxed?: boolean` to `DaemonStatus`

#### Task 5.2: Force permission approval in sandbox mode

**Files:**
- Modify: `packages/daemon/src/relay.ts`

When `sandbox: true` for a project, the daemon ensures all file write and shell command permissions are forwarded to the phone for approval — never auto-approved. This is the primary v1 sandbox behavior.

#### Task 5.3: Surface sandbox status in UI

**Files:**
- Modify: `packages/mobile/src/components/ConnectionBanner.tsx`
- Modify: `packages/mobile/src/stores/connection.ts`

Show a "Sandboxed" badge when `DaemonStatus.sandboxed` is true.

#### Task 5.4: Add --sandbox to CLI

**Files:**
- Modify: `packages/cli/src/cli.ts`

Pass through to project config on startup.

---

## Phase 4 — Depends on Phases 2+3

### Feature 6: Auto-Start Toggle

#### Task 6.1: Create global config schema

**Files:**
- Create: `packages/daemon/src/global-config.ts`

```typescript
interface MastConfig {
  autoStart: boolean;
  orchestratorUrl: string;
  watchDirectories?: string[];
}
```

Load from `~/.mast/config.json`, create with defaults if missing.

#### Task 6.2: Implement `mast daemon` long-running mode

**Files:**
- Modify: `packages/cli/src/cli.ts`

`mast daemon` starts the daemon and watches for new OpenCode processes using the discovery mechanism from Feature 3. Auto-registers discovered instances.

#### Task 6.3: Generate platform service configs

**Files:**
- Create: `packages/cli/src/service.ts`

`mast daemon install` prints:
- **Linux:** systemd unit file
- **macOS:** launchd plist
- **Windows:** Task Scheduler XML or nssm instructions

With instructions for the user to install it.

#### Task 6.4: Per-project remote toggle

**Files:**
- Modify: `packages/daemon/src/project-config.ts` — add `remote?: boolean` to `Project`

Projects with `remote: false` are started by the daemon but not relayed to the orchestrator.

---

## Phase 5 — Depends on Phase 1 (Web Client)

### Feature 7: Multi-Surface Simultaneous Use

#### Task 7.1: Add interactive REPL to daemon

**Files:**
- Create: `packages/daemon/src/repl.ts`

Read stdin line-by-line. On input, send `POST /session/:id/prompt_async` directly to the local OpenCode instance. Display streamed SSE responses formatted for the terminal.

#### Task 7.2: Broadcast daemon-originated messages

**Files:**
- Modify: `packages/daemon/src/relay.ts`

When the daemon REPL sends a message, emit a synthetic `event` message through the WSS so the orchestrator (and therefore phone + web) see the user message appear.

#### Task 7.3: Handle concurrent input

**Files:**
- Modify: `packages/daemon/src/repl.ts`

If OpenCode is currently generating (streaming), disable REPL input and show "Agent working..." status. Re-enable on `message.completed`.

#### Task 7.4: Three-way sync test

Manual test: send a message from the daemon terminal, verify it appears on phone and web. Send a message from the web, verify it appears on phone and terminal. Send from phone, verify terminal and web.

---

## Execution Order Summary

```
Phase 1 (parallel):
  Feature 4: MCP Passthrough        [Tasks 4.1-4.4]    ~1 day
  Feature 1: Web Client             [Tasks 1.1-1.11]   ~3-5 days

Phase 2:
  Feature 2: Zero-Config CLI        [Tasks 2.1-2.4]    ~2 days

Phase 3 (parallel, after Phase 2):
  Feature 3: Mid-Session Attach     [Tasks 3.1-3.4]    ~2 days
  Feature 5: Sandboxing             [Tasks 5.1-5.4]    ~1 day

Phase 4 (after Phases 2+3):
  Feature 6: Auto-Start Toggle      [Tasks 6.1-6.4]    ~2 days

Phase 5 (after Phase 1):
  Feature 7: Multi-Surface Sync     [Tasks 7.1-7.4]    ~2 days
```

Total: ~13-17 days of focused work.
