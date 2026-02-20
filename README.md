# Mast

Mobile-first async collaboration interface for directing AI coding agents against real GitHub repos.

Plan, review, approve, and ship AI-generated code from your phone.

## What is this?

As AI agents write more code, the bottleneck shifts from *writing* to *reviewing, approving, and directing*. That doesn't require a keyboard or an IDE — it requires a conversation.

Mast gives you a mobile chat interface to collaborate with [OpenCode](https://opencode.ai) (an AI coding agent). The workflow is async:

1. **Plan together** — chat with the agent about what to build (sync, from your phone)
2. **Agent executes** — it writes code, runs tests, makes changes (async, phone in pocket)
3. **Review and decide** — get a push notification when the agent needs approval, review diffs, approve or deny (sync)
4. **Ship** — one tap

Mast is NOT a mobile IDE, a remote desktop, or a new AI agent. It's a thin relay layer that connects your phone to an existing agent running on your dev machine.

## Architecture

```
┌─────────┐       WSS        ┌──────────────┐       WSS        ┌─────────────┐
│  Phone  │ ──────────────── │ Orchestrator │ ──────────────── │   Daemon    │
│ (Expo)  │   outbound-only  │   (Azure)    │   outbound-only  │ (dev machine)│
└─────────┘                  └──────────────┘                  └──────┬──────┘
                                                                      │ HTTP + SSE
                                                                ┌─────┴──────┐
                                                                │  OpenCode  │
                                                                │ (localhost) │
                                                                └────────────┘
```

Three components, zero inbound ports:

- **Phone** (`packages/mobile`) — React Native / Expo app. Chat UI, permission approvals, diff review, push notifications.
- **Orchestrator** (`packages/orchestrator`) — Node.js server deployed to Azure Container Apps. Relays messages between phone and daemon. Caches sessions in Supabase. Sends push notifications.
- **Daemon** (`packages/daemon`) — Node.js process on your dev machine. Manages the OpenCode process, relays HTTP requests and SSE events through a persistent WSS connection to the orchestrator.

Both phone and daemon connect *outbound* to the orchestrator. Credentials never leave the dev machine.

## Monorepo Structure

```
mast/
├── packages/
│   ├── shared/          @mast/shared — WSS protocol types and constants
│   ├── orchestrator/    @mast/orchestrator — cloud relay server
│   ├── daemon/          @mast/daemon — dev machine agent
│   └── mobile/          @mast/mobile — Expo React Native app
├── supabase/
│   └── migrations/      Database schema (sessions, messages, push_tokens)
├── docs/plans/          Implementation plans and test plans
├── Dockerfile           Azure Container Apps deployment for orchestrator
└── package.json         npm workspace root
```

This is a standard npm workspaces monorepo. Each package has its own dependencies and can be deployed independently. They share types through `@mast/shared`.

## Prerequisites

- **Node.js** v24+ (uses `node:test` for zero-dependency testing)
- **npm** v10+ (workspace support)
- **OpenCode** installed and configured on your dev machine
- **Expo Go** app on your iPhone (for development)
- **Supabase** project (optional — falls back to in-memory store without it)

## Quick Start

### Install dependencies

```bash
npm install
```

This installs all workspace packages in one go.

### Run the orchestrator (local dev)

```bash
npm run dev --workspace=packages/orchestrator
```

Starts on `http://localhost:3000`. Without Supabase env vars, it uses an in-memory session store.

For production (Supabase persistence):
```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-anon-key \
npm start --workspace=packages/orchestrator
```

### Run the daemon

```bash
npm run dev --workspace=packages/daemon
```

On first run, the daemon will display a 6-digit pairing code (and QR code) in the terminal. Enter this code on the mobile app to pair.

Environment variables:
- `MAST_ORCHESTRATOR_URL` — orchestrator WebSocket URL (default: `ws://localhost:3000`)
- `OPENCODE_PORT` — port for `opencode serve` (default: `4096`)
- `MAST_SKIP_OPENCODE=1` — skip starting OpenCode (for testing)

### Run the mobile app

```bash
npx expo start --workspace=packages/mobile
```

Or from the mobile directory:
```bash
cd packages/mobile
npx expo start
```

Scan the QR code with Expo Go on your iPhone.

### Run tests

```bash
npm test
```

Runs all 110 tests (95 orchestrator + 15 daemon). Tests use `node:test` — no Jest or Vitest needed.

## Key Features

- **Pairing flow** — daemon generates a 6-digit code + QR code. Phone scans or enters the code to pair. Device key is saved to `~/.mast/device-key.json`.
- **Streaming chat** — SSE events from OpenCode (message creation, part updates, completions) are relayed in real-time through the daemon WSS to the phone.
- **Permission gates** — when OpenCode needs approval (file writes, shell commands), a push notification is sent. Approve or deny from the phone.
- **Session cache** — messages are cached in the orchestrator (in-memory or Supabase). If the daemon disconnects and reconnects, missed messages are synced back.
- **Push notifications** — Expo push notifications for permission requests, agent completion, and daemon disconnect (with 30s grace period).
- **Health monitoring** — orchestrator monitors OpenCode health via the daemon. Automatic restart on crash. Exponential backoff on reconnection.
- **Dark mode** — system-aware dark mode via NativeWind.

## Deployment

The orchestrator runs on Azure Container Apps. The image is built and pushed to Azure Container Registry (ACR), then deployed as a container app.

```bash
# Build and push image to ACR
az acr build --registry your-registry --resource-group your-resource-group \
  --image mast-orchestrator:v1 --platform linux/amd64 .

# Update the container app (after image push)
az containerapp update --name mast-orchestrator --resource-group your-resource-group \
  --image your-registry.azurecr.io/mast-orchestrator:v1
```

Environment variables are set via:
```bash
az containerapp update --name mast-orchestrator --resource-group your-resource-group \
  --set-env-vars "SUPABASE_URL=..." "SUPABASE_ANON_KEY=..."
```

**Live URL:** `https://your-orchestrator.azurecontainerapps.io`

The daemon runs on your dev machine. The mobile app runs on your phone via Expo Go (dev) or a standalone build (production).

## Tech Stack

| Layer | Tech |
|---|---|
| Mobile | React Native, Expo, Expo Router, NativeWind (Tailwind), Zustand |
| Orchestrator | Node.js, Hono, ws, Supabase JS |
| Daemon | Node.js, ws, child_process (OpenCode) |
| Shared | TypeScript (ES2022, Node16 modules) |
| Database | Supabase (PostgreSQL) |
| Hosting | Azure Container Apps |
| Testing | node:test (zero dependencies) |
| Agent | OpenCode (via `opencode serve` API) |

## Status

All 5 MVP phases are complete. The project is ready for dogfooding on a real codebase.

## License

Private. Not yet open source.
