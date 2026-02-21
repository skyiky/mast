# Mast

> Touch grass. Ship code.

Mast is a mobile interface for directing AI coding agents. A phone app connects to an orchestrator server, which relays to a daemon on your dev machine, which controls an [OpenCode](https://opencode.ai) agent process.

You chat with the agent from your phone. The agent writes code on your machine. When it needs approval for file writes or shell commands, you get a push notification and approve or deny from wherever you are.

The workflow is async by design. You plan with the agent, put your phone away while it works, then come back to review diffs and approve changes when it's done.

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

All connections are outbound. Neither the phone nor the dev machine expose inbound ports. Credentials stay on the dev machine.

- **Phone** (`packages/mobile`) — React Native / Expo app. Chat UI, permission approvals, diff review, push notifications.
- **Orchestrator** (`packages/orchestrator`) — Node.js server deployed to Azure Container Apps. Relays messages between phone and daemon, caches sessions in Supabase, sends push notifications.
- **Daemon** (`packages/daemon`) — Node.js process on your dev machine. Manages the OpenCode process and relays HTTP requests and SSE events through a persistent WSS connection to the orchestrator.

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
├── Dockerfile           Azure Container Apps deployment for orchestrator
└── package.json         npm workspace root
```

All packages share types through `@mast/shared` and can be deployed independently.

## Prerequisites

- **Node.js** v24+ (uses `node:test` for zero-dependency testing)
- **npm** v10+ (workspace support)
- **OpenCode** installed and configured on your dev machine
- **Expo Go** on your phone (for development)
- **Supabase** project (optional — falls back to in-memory store without it)

## Quick Start

### Install dependencies

```bash
npm install
```

### Run the orchestrator (local dev)

```bash
npm run dev --workspace=packages/orchestrator
```

Starts on `http://localhost:3000`. Without Supabase env vars, it uses an in-memory session store.

For production with Supabase persistence:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-anon-key \
npm start --workspace=packages/orchestrator
```

### Run the daemon

```bash
npm run dev --workspace=packages/daemon
```

On first run, the daemon displays a 6-digit pairing code and QR code in the terminal. Enter this code on the mobile app to pair. The device key is saved to `~/.mast/device-key.json`.

Environment variables:

- `MAST_ORCHESTRATOR_URL` — orchestrator WebSocket URL (default: `ws://localhost:3000`)
- `OPENCODE_PORT` — port for `opencode serve` (default: `4096`)
- `MAST_SKIP_OPENCODE=1` — skip starting OpenCode (for testing)

### Run the mobile app

```bash
cd packages/mobile
npx expo start
```

Scan the QR code with Expo Go on your phone.

### Run tests

```bash
npm test
```

110 tests across the orchestrator (95) and daemon (15). Tests use `node:test` with no external framework.

## How It Works

The daemon subscribes to OpenCode's SSE event stream and forwards events (message creation, part updates, completions) through the WSS connection to the orchestrator, which broadcasts them to connected phones.

When OpenCode needs approval for a file write or shell command, the orchestrator sends a push notification. You approve or deny from the phone, and the decision is relayed back through the same chain.

If the daemon disconnects and reconnects, the orchestrator sends a sync request with cached session IDs and timestamps. The daemon queries OpenCode for missed messages and backfills the gap. Reconnection uses exponential backoff (1s to 30s) with jitter.

The orchestrator monitors OpenCode's health through the daemon, checking every 30 seconds. If OpenCode crashes, the daemon restarts it automatically.

## Deployment

The orchestrator deploys to Azure Container Apps. Build and push the image to Azure Container Registry, then update the container app:

```bash
az acr build --registry your-registry --resource-group your-resource-group \
  --image mast-orchestrator:v1 --platform linux/amd64 .

az containerapp update --name mast-orchestrator --resource-group your-resource-group \
  --image your-registry.azurecr.io/mast-orchestrator:v1
```

Set environment variables:

```bash
az containerapp update --name mast-orchestrator --resource-group your-resource-group \
  --set-env-vars "SUPABASE_URL=..." "SUPABASE_ANON_KEY=..."
```

The daemon runs on your dev machine. The mobile app runs on your phone via Expo Go (development) or a standalone build (production).

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

## License

Private. Not yet open source.
