# Mast Roadmap

## Immediate Next Features

Gaps identified by comparing Mast against [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) — features they ship that we don't yet have.

### 1. Web Browser Client

**Priority:** High
**Status:** Done

Claude RC works from any browser via claude.ai/code. Mast requires installing the native mobile app. A web client would lower the barrier to entry and let users access sessions from any laptop or desktop without installing anything.

**Implemented:**
- `@mast/web` package — Vite + React 19 + Zustand 5 SPA in `packages/web`
- WebSocket connection to orchestrator using the same `/ws?token=` endpoint
- Feature parity with mobile: chat, permission approval, diff review, session list, project filter, settings
- Session controls: abort execution, view diff (modal with +/- coloring), revert last response
- Settings page: connection status, verbosity/mode toggles, re-pair, sign out
- Responsive terminal-dark UI with JetBrains Mono, CSS custom properties
- 185 tests (API, event handler, stores, hooks, utils) using Node.js built-in test runner

### 2. Zero-Config Setup

**Priority:** High
**Status:** Done

Claude RC is a single command: `claude remote-control`. Mast requires installing the daemon, configuring projects in `~/.mast/projects.json`, pairing a device, and having an orchestrator running. The onboarding friction is significantly higher.

**Implemented:**
- `@mast/cli` package — `npx mast` starts everything with zero config
- Auto-detects current directory as project, creates `~/.mast/projects.json` on first run
- Supports positional directory arg, `--port`, `--orchestrator`, `--sandbox` flags
- `mast attach <url>` subcommand (placeholder, Feature 3 skipped)
- esbuild-bundled single-file binary (`dist/cli.mjs`) with only `ws` as runtime dependency
- 32 tests (args parsing, auto-detect, runner) all using Node.js built-in test runner

### 3. Mid-Session Attach

**Priority:** Low
**Status:** Skipped

Claude RC lets you run `/remote-control` inside an already-running conversation to make it remote. Mast's daemon must be running from the start — you can't retroactively make an existing OpenCode session remotely accessible.

**Decision:** Skipped. Since `npx mast` already spawns OpenCode and connects the daemon, the normal workflow never needs mid-session attach. The only scenarios (forgot to use Mast, someone else started OpenCode, opt-in per-session) are edge cases not worth the complexity. Can revisit if user demand materializes.

### 4. MCP Server Passthrough

**Priority:** Medium
**Status:** Done

Claude RC explicitly states that MCP servers configured in the project stay available during remote sessions. Mast relays HTTP/SSE to OpenCode but doesn't ensure MCP servers are accessible or surfaced to the phone.

**Implemented:**
- `GET /mcp-servers` endpoint in orchestrator and daemon relay
- Aggregates MCP server status from all running OpenCode instances via `GET /mcp`
- `fetchMcpServers()` in mobile API client
- MCP servers section in mobile settings screen showing each server's name and connection status
- Multi-project aware: groups servers by project when multiple projects are configured

### 5. Sandboxing Mode

**Priority:** Low
**Status:** Skipped

Claude RC offers `--sandbox` / `--no-sandbox` flags for filesystem and network isolation during remote sessions. Mast has no equivalent — the agent runs with full access to the dev machine.

**Decision:** Skipped. OpenCode has no built-in sandbox flags (`opencode serve --help` shows only `--port`, `--hostname`, `--mdns`, `--cors`), so Mast would need to implement OS-level isolation itself — significant complexity for unclear user demand. Can revisit if needed.

### 6. Enable Remote Control for All Sessions Toggle

**Priority:** Low
**Status:** Not started

Claude RC has a global config to automatically enable remote control for every session. Mast's daemon is always-on per-project (architecturally different), but there's no equivalent of "opt out of remote for this session" or "auto-start daemon when I open a project."

**Scope:**
- System-level daemon that starts on login / boot (systemd service, launchd plist, or Windows startup)
- Auto-discover new project directories when OpenCode starts (watch for `opencode serve` processes)
- Per-project toggle: "remote enabled" vs "local only" in `projects.json`
- Global config file at `~/.mast/config.json` with `autoStart: true/false`

### 7. Multi-Surface Simultaneous Use

**Priority:** Low
**Status:** Not started

Claude RC explicitly supports using terminal + browser + phone interchangeably on the same session — messages sent from any surface appear on all others. Mast's daemon terminal is a status display, not an interactive chat surface.

**Scope:**
- Make the daemon terminal an interactive chat interface (read user input, display streamed responses)
- Sync messages bidirectionally: phone → orchestrator → daemon terminal, and daemon terminal → orchestrator → phone
- Web client (from feature 1) also participates as a third surface
- All surfaces see the same conversation state in real-time
- Handle input conflicts gracefully (two surfaces typing simultaneously)

---

## Existing Planned Features

These features were already planned before the Claude RC comparison:

### Multi-Agent Support (Claude Code)
**Status:** Spike planned (see `docs/plans/claude-code-spike.md`)

Add Claude Code as a second agent via an `AgentAdapter` interface, `AgentRouter`, and semantic WSS protocol. Per-session agent selection.

### Production Hardening
**Status:** In progress (see `docs/SECURITY.md` known gaps)

- Token storage: AsyncStorage → SecureStore
- Rate limiting
- Supabase row-level security
- Audit logging
- Device key revocation
- Token refresh
- Configurable approval policies
- Self-hosted install docs
- Auto-update mechanism
