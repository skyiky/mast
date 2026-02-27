# Single-Command Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `npx mast` starts everything (orchestrator + daemon + OpenCode) in one process and serves the web UI, so a new user goes from zero to controlling an AI agent in one command.

**Architecture:** The CLI embeds the orchestrator server in-process (importing `startServer` from `@mast/orchestrator`). The orchestrator serves the web client's built `dist/` files as static assets at `/`. The daemon relay connects to the in-process orchestrator via `ws://localhost:<port>`. No separate processes, no manual setup.

**Tech Stack:** Node.js, esbuild (CLI bundler), Hono (orchestrator HTTP), Vite (web client build), existing Mast packages.

---

### Task 1: Serve web client static files from orchestrator

The orchestrator's Hono app needs to serve `packages/web/dist/` as static files. Any request that doesn't match an API route or WSS upgrade gets the web client.

**Files:**
- Modify: `packages/orchestrator/src/routes.ts` — add static file middleware
- Modify: `packages/orchestrator/src/server.ts` — pass webDistPath config option
- Test: `packages/orchestrator/test/static-files.test.ts`

**Step 1: Write failing test for static file serving**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

describe("static file serving", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-static-test");

  // Create temp dist directory with test files
  it("serves index.html at /", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.includes("<html>test</html>"));
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves assets from subdirectories", async () => {
    mkdirSync(join(tmpDir, "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");
    writeFileSync(join(tmpDir, "assets", "app.js"), "console.log('hi')");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/assets/app.js`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(body, "console.log('hi')");
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns index.html for SPA routes (client-side routing)", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>spa</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/sessions/abc`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.includes("<html>spa</html>"));
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("API routes still take priority over static files", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not serve static files when webDistPath is not set", async () => {
    const handle = await startServer(0, { devMode: true });

    try {
      const res = await fetch(`http://localhost:${handle.port}/`);
      // Should be 404, not 200 (no static files configured)
      assert.equal(res.status, 404);
    } finally {
      await handle.close();
    }
  });
});
```

**Step 2: Run test, verify it fails**

Run: `node --import tsx --test packages/orchestrator/test/static-files.test.ts`
Expected: FAIL — `webDistPath` option doesn't exist, no static serving

**Step 3: Implement static file serving**

Add `webDistPath?: string` to `ServerConfig`. In `routes.ts`, add a catch-all Hono route that:
1. Checks if the requested path maps to a real file in `webDistPath`
2. If yes, serve it with correct MIME type
3. If no file matches and it's a non-API/non-asset path, serve `index.html` (SPA fallback)
4. Use `node:fs` `readFile` — no extra dependencies

MIME types to handle: `.html` → `text/html`, `.js` → `application/javascript`, `.css` → `text/css`, `.json` → `application/json`, `.png/.jpg/.svg/.ico` → appropriate image types.

**Step 4: Run tests, verify pass**

Run: `node --import tsx --test packages/orchestrator/test/static-files.test.ts`
Expected: All 5 tests pass

**Step 5: Run full orchestrator test suite to check for regressions**

Run: `npm test --workspace=packages/orchestrator`
Expected: All existing tests still pass

**Step 6: Commit**

```
feat(orchestrator): serve web client static files

Add webDistPath config option to serve built web client files.
Supports SPA fallback routing and correct MIME types.
API routes take priority over static files.
```

---

### Task 2: Embed orchestrator in CLI

The CLI currently starts only the daemon. Add orchestrator startup before daemon startup.

**Files:**
- Modify: `packages/cli/src/runner.ts` — add orchestrator startup to the flow
- Modify: `packages/cli/src/cli.ts` — wire real orchestrator startup
- Modify: `packages/cli/src/args.ts` — add `--orchestrator-port` flag (default 3000)
- Test: `packages/cli/test/runner.test.ts` — add tests for embedded orchestrator

**Step 1: Write failing tests**

```typescript
// Add to existing runner tests
describe("embedded orchestrator", () => {
  it("starts orchestrator and reports its URL", async () => {
    let orchestratorStarted = false;
    let orchestratorPort: number | undefined;

    const result = await startCli(
      {
        command: "start",
        directory: "/test",
        port: 4096,
        orchestratorUrl: "", // empty = embedded mode
        sandbox: false,
      },
      {
        ...fakeDeps,
        startOrchestrator: async (opts) => {
          orchestratorStarted = true;
          orchestratorPort = opts.port;
          return {
            port: opts.port,
            shutdown: async () => {},
          };
        },
      },
    );

    assert.equal(orchestratorStarted, true);
    assert.equal(result.action, "started");
  });
});
```

**Step 2: Run tests, verify fail**

Run: `node --import tsx --test packages/cli/test/runner.test.ts`
Expected: FAIL — `startOrchestrator` doesn't exist in CliDeps

**Step 3: Implement embedded orchestrator in runner**

Update `CliDeps` to include `startOrchestrator`. Update `startCli` to:
1. Start orchestrator first (if no external `--orchestrator` URL provided)
2. Use the orchestrator's actual port to construct the WSS URL for the daemon relay
3. Print the web UI URL

**Step 4: Wire real implementation in cli.ts**

In `cli.ts`, import `startServer` from `@mast/orchestrator/server` and pass it as `startOrchestrator`. Locate the web dist path relative to the package (resolved at build time or via `import.meta`).

**Step 5: Run tests, verify pass**

Run: `node --import tsx --test packages/cli/test/runner.test.ts`
Expected: All tests pass

**Step 6: Commit**

```
feat(cli): embed orchestrator in npx mast

The CLI now starts the orchestrator in-process before the daemon.
No separate orchestrator process needed for local development.
Web UI served at http://localhost:3000.
```

---

### Task 3: Auto-configure web client connection

The web client currently requires the user to manually enter the server URL during a "login" step. For the embedded local flow, the web client should auto-connect when served from the orchestrator.

**Files:**
- Modify: `packages/web/src/App.tsx` — detect same-origin serving, skip login
- Modify: `packages/web/src/stores/connection.ts` — add auto-connect logic
- Test: `packages/web/test/auto-connect.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectLocalMode } from "../src/lib/local-mode.ts";

describe("local mode detection", () => {
  it("detects local mode when served from orchestrator", () => {
    const result = detectLocalMode("http://localhost:3000");
    assert.equal(result.isLocal, true);
    assert.equal(result.serverUrl, "http://localhost:3000");
    assert.equal(result.wsUrl, "ws://localhost:3000");
    assert.equal(result.apiToken, "mast-api-token-phase1");
  });

  it("detects local mode on any localhost port", () => {
    const result = detectLocalMode("http://localhost:8080");
    assert.equal(result.isLocal, true);
    assert.equal(result.serverUrl, "http://localhost:8080");
  });

  it("does not detect local mode for remote URLs", () => {
    const result = detectLocalMode("https://mast.example.com");
    assert.equal(result.isLocal, false);
  });
});
```

**Step 2: Run test, verify fail**

Run: `node --import tsx --test packages/web/test/auto-connect.test.ts`
Expected: FAIL — `detectLocalMode` doesn't exist

**Step 3: Implement local mode detection**

Create `packages/web/src/lib/local-mode.ts`:
- `detectLocalMode(origin: string)` — checks if origin is `localhost` or `127.0.0.1`
- If local: return `{ isLocal: true, serverUrl, wsUrl, apiToken: HARDCODED_API_TOKEN }`
- If remote: return `{ isLocal: false }`

Update `App.tsx` or the connection store initialization:
- On app mount, call `detectLocalMode(window.location.origin)`
- If local and not already paired: auto-set serverUrl, wsUrl, apiToken, and paired=true
- Skip the login/pair screens entirely — go straight to session list

**Step 4: Run tests, verify pass**

Run: `node --import tsx --test packages/web/test/auto-connect.test.ts`
Expected: All tests pass

**Step 5: Run full web test suite**

Run: `npm test --workspace=packages/web`
Expected: All existing tests still pass

**Step 6: Commit**

```
feat(web): auto-connect in local mode

When served from localhost, the web client automatically connects
with dev tokens — no manual URL entry or pairing needed.
```

---

### Task 4: Update CLI build to bundle orchestrator + locate web dist

The CLI's esbuild config needs to bundle `@mast/orchestrator` and resolve the web client's dist path.

**Files:**
- Modify: `packages/cli/build.mjs` — add `@mast/orchestrator` to bundled deps
- Modify: `packages/cli/package.json` — add `@mast/orchestrator` as devDependency
- Modify: `packages/cli/src/cli.ts` — resolve web dist path

**Step 1: Update package.json**

Add `"@mast/orchestrator": "*"` to devDependencies in `packages/cli/package.json`.

**Step 2: Update build.mjs**

The orchestrator uses `hono`, `@hono/node-server`, and `@supabase/supabase-js`. These need to either be bundled or externalized. Since Supabase client is large and optional for local mode, externalize it (or make the import conditional).

Key decisions:
- `hono` and `@hono/node-server`: bundle (small, no native deps)
- `@supabase/supabase-js`: externalize (large, only needed for production)
- `ws`: already externalized

Update `external` array: `["ws", "@supabase/supabase-js"]`

**Step 3: Handle web dist path**

The CLI needs to locate `packages/web/dist/` at runtime. Two approaches:
- In dev (tsx): resolve relative to `import.meta.dirname`
- In bundled mode: the web dist files need to be copied into the CLI's dist or referenced by absolute path

For `npx mast` (installed from npm), the web dist should be bundled with the CLI package. Add `packages/web/dist/` to the CLI's `"files"` array and resolve it at runtime.

Simpler approach: add `@mast/web` as a devDependency with a `"dist"` export, and resolve it via `import.meta.resolve("@mast/web/dist")` or a similar mechanism.

**Step 4: Build and verify**

Run: `node build.mjs` in `packages/cli/`
Expected: `dist/cli.mjs` built successfully, no missing module errors

**Step 5: Smoke test the built CLI**

Run: `MAST_SKIP_OPENCODE=1 node packages/cli/dist/cli.mjs`
Expected: Orchestrator starts, web UI served, daemon connects (OpenCode skipped)

**Step 6: Commit**

```
feat(cli): bundle orchestrator and web dist in CLI build

npx mast now includes the orchestrator server and web client.
Single binary serves everything needed for local development.
```

---

### Task 5: Update CLI output and add --orchestrator flag for external mode

When embedded orchestrator is used, print a clear banner. When `--orchestrator <url>` is passed, use external mode (existing behavior).

**Files:**
- Modify: `packages/cli/src/runner.ts` — conditional orchestrator startup
- Modify: `packages/cli/src/args.ts` — make orchestrator URL optional (empty = embedded)
- Test: `packages/cli/test/runner.test.ts` — test both modes

**Step 1: Write failing test for external mode**

```typescript
it("uses external orchestrator when --orchestrator is provided", async () => {
  let orchestratorStarted = false;

  const result = await startCli(
    {
      command: "start",
      directory: "/test",
      port: 4096,
      orchestratorUrl: "ws://remote:3000",
      sandbox: false,
    },
    {
      ...fakeDeps,
      startOrchestrator: async () => {
        orchestratorStarted = true;
        return { port: 3000, shutdown: async () => {} };
      },
    },
  );

  // Should NOT start embedded orchestrator when external URL is provided
  assert.equal(orchestratorStarted, false);
  assert.equal(result.action, "started");
});
```

**Step 2: Run tests, verify behavior**

**Step 3: Implement conditional logic**

In `startCli`:
- If `config.orchestratorUrl` is empty/undefined → start embedded orchestrator, use its port
- If `config.orchestratorUrl` is set → use external (existing behavior), don't start orchestrator

In `parseCliArgs`:
- Change default orchestrator URL from `"ws://localhost:3000"` to `""` (empty = embedded)
- `--orchestrator <url>` still works as an override

**Step 4: Update CLI banner output**

When embedded:
```
[mast] Detected project: my-app (/path/to/my-app)
[mast] Starting OpenCode on port 4096...
[mast] OpenCode ready
[mast] Web UI: http://localhost:3000
```

**Step 5: Run all CLI tests**

Run: `npm test --workspace=packages/cli`
Expected: All tests pass

**Step 6: Commit**

```
feat(cli): embedded orchestrator by default, --orchestrator for external

npx mast now starts everything locally. Use --orchestrator <url>
to connect to a remote orchestrator instead.
```

---

### Task 6: End-to-end smoke test and cleanup

Verify the full flow works end-to-end.

**Files:**
- Modify: `packages/cli/src/runner.ts` — fix any issues found
- Modify: `docs/ROADMAP.md` — update status

**Step 1: Run the full flow**

```bash
MAST_SKIP_OPENCODE=1 npx tsx packages/cli/src/cli.ts
```

Expected:
1. Orchestrator starts on port 3000
2. Daemon connects to orchestrator
3. Web UI accessible at http://localhost:3000
4. Opening the URL shows the web client
5. Web client auto-connects (no login screen)
6. Session list loads (empty, since OpenCode is skipped)

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass across all packages

**Step 3: Update ROADMAP.md**

Note the single-command experience as completed.

**Step 4: Commit**

```
feat: single-command experience - npx mast does everything

One command starts orchestrator + daemon + web UI.
Open http://localhost:3000 to control AI agents from the browser.
```
