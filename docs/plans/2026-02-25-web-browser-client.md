# Web Browser Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a responsive web SPA that provides feature parity with the mobile app — chat, session list, permission approval, diff review, settings — accessible from any browser.

**Architecture:** Vite + React + Zustand SPA in `packages/web`. Reuses the mobile's pure-function API client and event handler verbatim (copied, not shared — avoids coupling). Zustand stores adapted from mobile but using `localStorage` instead of AsyncStorage. CSS via plain CSS with CSS custom properties for theming (same terminal-dark palette). React Router for navigation. Markdown rendered with `react-markdown` + `remark-gfm`.

**Tech Stack:** Vite 6, React 19, Zustand 5, React Router 7, react-markdown, remark-gfm

---

## Architecture Decisions

### Why copy `api.ts` / `event-handler.ts` instead of sharing?
- Mobile types are defined inline (no `@mast/shared` import in mobile)
- Sharing would require extracting to a new `@mast/web-shared` package — overhead for two consumers
- Copy is ~550 lines total. Divergence risk is low since the orchestrator protocol is stable.
- YAGNI: extract to shared package only if a third consumer appears

### Why plain CSS instead of Tailwind / CSS-in-JS?
- Terminal-dark theme maps directly to CSS custom properties
- No build tooling overhead
- JetBrains Mono from Google Fonts (no font bundling)
- Mobile-first responsive via media queries

### Auth flow
- Dev mode: hardcoded token input (same as mobile dev flow)
- Production: Supabase GitHub OAuth via `@supabase/supabase-js` (browser SDK)
- Pairing: same `POST /pair/verify` with code input

### What NOT to build (YAGNI)
- Push notifications (browser Notification API is a future feature)
- QR code scanning (phone-only)
- Swipe gestures (mouse-based interactions instead)
- Expo-specific features (deep links, app updates)

---

## Task Breakdown

### Task 1: Scaffold Vite + React project

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`

**Step 1: Create package.json**

```json
{
  "name": "@mast/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --import tsx --test --test-force-exit test/*.test.ts"
  },
  "dependencies": {
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-router-dom": "^7",
    "zustand": "^5",
    "react-markdown": "^10",
    "remark-gfm": "^4"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4",
    "tsx": "^4",
    "typescript": "^5",
    "vite": "^6"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

**Step 3: Create vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to orchestrator in dev
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
```

**Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mast</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Step 5: Create src/main.tsx and src/App.tsx (minimal shell)**

`src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`:
```tsx
export function App() {
  return <div className="app">Mast Web</div>;
}
```

**Step 6: Install deps and verify dev server starts**

Run: `npm install` (from workspace root)
Run: `npm run dev` (from `packages/web`)
Expected: Vite dev server on localhost:5173 showing "Mast Web"

**Step 7: Commit**

```
feat(web): scaffold Vite + React project
```

---

### Task 2: Global CSS + theme tokens

**Files:**
- Create: `packages/web/src/styles/global.css`
- Create: `packages/web/src/styles/theme.css`

**Step 1: Create theme.css with CSS custom properties**

Map the terminal-dark palette from mobile's `themes.ts` to CSS vars:

```css
:root {
  --bg: #0A0A0A;
  --surface: #141414;
  --border: #262626;
  --dim: #525252;
  --muted: #737373;
  --text: #D4D4D4;
  --bright: #FAFAFA;
  --accent: #22D3EE;
  --accent-dim: #164E63;
  --success: #22C55E;
  --success-dim: #166534;
  --warning: #F59E0B;
  --warning-dim: #78350F;
  --danger: #EF4444;
  --danger-dim: #7F1D1D;
  --font: "JetBrains Mono", monospace;
  --radius: 8px;
}
```

**Step 2: Create global.css with base reset and layout**

```css
@import "./theme.css";

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Scrollbar styling */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--dim); }

/* Utility classes */
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
```

**Step 3: Verify styles load**

Run dev server, confirm dark background and JetBrains Mono font.

**Step 4: Commit**

```
feat(web): add terminal-dark theme CSS and global styles
```

---

### Task 3: API client + event handler (copy from mobile)

**Files:**
- Create: `packages/web/src/lib/api.ts` (copy from mobile)
- Create: `packages/web/src/lib/event-handler.ts` (copy from mobile)
- Create: `packages/web/test/api.test.ts`
- Create: `packages/web/test/event-handler.test.ts`

**Step 1: Copy api.ts from mobile verbatim**

Copy `packages/mobile/src/lib/api.ts` → `packages/web/src/lib/api.ts`.
No changes needed — it's pure `fetch`, no React Native deps.

**Step 2: Copy event-handler.ts from mobile, adjust import path**

Copy `packages/mobile/src/lib/event-handler.ts` → `packages/web/src/lib/event-handler.ts`.
Change the import from `../stores/sessions` to `../stores/sessions.js`.
(The types `ChatMessage`, `MessagePart`, `PermissionRequest` will be defined in the web stores, same shapes.)

**Step 3: Write tests for api.ts**

Copy `packages/mobile/test/api.test.ts` → `packages/web/test/api.test.ts`.
Adjust imports. Tests use `globalThis.fetch` mock — same approach works in Node.

**Step 4: Write tests for event-handler.ts**

Copy `packages/mobile/test/event-handler.test.ts` → `packages/web/test/event-handler.test.ts`.
Adjust imports.

**Step 5: Run tests**

Run: `npm test --workspace=packages/web`
Expected: All tests pass

**Step 6: Commit**

```
feat(web): add API client and event handler (ported from mobile)
```

---

### Task 4: Zustand stores (connection + sessions + settings)

**Files:**
- Create: `packages/web/src/stores/connection.ts`
- Create: `packages/web/src/stores/sessions.ts`
- Create: `packages/web/src/stores/settings.ts`

**Step 1: Create connection store**

Same shape as mobile but with `localStorage` persistence:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Same interface as mobile — see packages/mobile/src/stores/connection.ts
// Only difference: persist to localStorage instead of AsyncStorage
```

Key changes from mobile:
- Remove `import AsyncStorage` and `createJSONStorage(() => AsyncStorage)`
- Zustand's default persist storage is `localStorage` — just omit the `storage` option

**Step 2: Create sessions store**

Same shape as mobile. Remove AsyncStorage import, use default localStorage.
Export the same types: `MessagePart`, `ChatMessage`, `Session`, `PermissionRequest`.

**Step 3: Create settings store**

Same as mobile minus `DEFAULT_THEME` import — hardcode `"terminal-dark"`.

**Step 4: Verify stores compile**

Run: `npx tsc --noEmit` (from packages/web)

**Step 5: Commit**

```
feat(web): add Zustand stores (connection, sessions, settings)
```

---

### Task 5: WebSocket hook

**Files:**
- Create: `packages/web/src/hooks/useWebSocket.ts`

**Step 1: Port useWebSocket from mobile**

Same logic — the browser WebSocket API is identical to React Native's.
Only changes:
- Import paths adjusted for web stores
- Remove React Native-specific console.warn comment

**Step 2: Verify compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(web): add WebSocket hook for real-time events
```

---

### Task 6: useApi hook

**Files:**
- Create: `packages/web/src/hooks/useApi.ts`

**Step 1: Port useApi from mobile**

Identical logic — same useCallback wrapping of api.ts functions.

**Step 2: Verify compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(web): add useApi hook
```

---

### Task 7: Router + layout + auth guard

**Files:**
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/pages/Layout.tsx`
- Create: `packages/web/src/pages/LoginPage.tsx`
- Create: `packages/web/src/pages/PairPage.tsx`
- Create: `packages/web/src/pages/SessionsPage.tsx`
- Create: `packages/web/src/pages/ChatPage.tsx`
- Create: `packages/web/src/pages/SettingsPage.tsx`
- Create: `packages/web/src/styles/layout.css`

**Step 1: Set up React Router with route guards**

```tsx
// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useConnectionStore } from "./stores/connection";
import { Layout } from "./pages/Layout";
import { LoginPage } from "./pages/LoginPage";
import { PairPage } from "./pages/PairPage";
import { SessionsPage } from "./pages/SessionsPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useWebSocket } from "./hooks/useWebSocket";

export function App() {
  const apiToken = useConnectionStore((s) => s.apiToken);
  const paired = useConnectionStore((s) => s.paired);

  // Connect WebSocket when authenticated + paired
  useWebSocket();

  if (!apiToken) return <LoginPage />;
  if (!paired) return <PairPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SessionsPage />} />
          <Route path="chat/:id" element={<ChatPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 2: Create Layout with sidebar/nav**

Desktop: sidebar with session list + main content area.
Mobile: bottom nav or hamburger menu.

```tsx
// Layout.tsx
import { Outlet, Link } from "react-router-dom";
import { ConnectionBanner } from "../components/ConnectionBanner";

export function Layout() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <Link to="/" className="logo">mast</Link>
          <Link to="/settings" className="nav-icon" title="Settings">⚙</Link>
        </div>
        <ConnectionBanner />
        {/* Session list will go here — rendered in sidebar on desktop */}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
```

**Step 3: Create placeholder pages**

Each page renders its name for now — real content comes in subsequent tasks.

**Step 4: Create layout.css**

```css
.layout {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 280px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.logo {
  font-size: 18px;
  font-weight: 600;
  color: var(--accent);
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Responsive: stack on mobile */
@media (max-width: 768px) {
  .layout { flex-direction: column; }
  .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
}
```

**Step 5: Verify navigation works**

Run dev server. Confirm:
- No token → login page
- With token, no paired → pair page
- With token + paired → session list with sidebar

**Step 6: Commit**

```
feat(web): add router, layout, and auth guard pages
```

---

### Task 8: Login page (dev mode + Supabase OAuth)

**Files:**
- Modify: `packages/web/src/pages/LoginPage.tsx`
- Create: `packages/web/src/styles/login.css`

**Step 1: Build login page**

Two modes:
- Dev mode: text input for server URL + "Connect" button that sets the hardcoded API token
- Production: "Sign in with GitHub" button via Supabase

For MVP, implement dev mode only. Supabase OAuth can be added later.

```tsx
export function LoginPage() {
  const [url, setUrl] = useState("http://localhost:3000");
  const setServerUrl = useConnectionStore((s) => s.setServerUrl);
  const setApiToken = useConnectionStore((s) => s.setApiToken);

  const handleConnect = () => {
    setServerUrl(url);
    setApiToken("mast-api-token-phase1");
  };

  return (
    <div className="login-page">
      <h1 className="login-title">mast</h1>
      <p className="login-subtitle">Mobile AI Session Terminal</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Orchestrator URL" />
      <button onClick={handleConnect}>Connect (Dev Mode)</button>
    </div>
  );
}
```

**Step 2: Style it**

**Step 3: Commit**

```
feat(web): add dev-mode login page
```

---

### Task 9: Pair page

**Files:**
- Modify: `packages/web/src/pages/PairPage.tsx`
- Create: `packages/web/src/styles/pair.css`

**Step 1: Build pair page**

6-digit code input (same as mobile). Calls `POST /pair/verify`.

```tsx
export function PairPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const api = useApi();
  const setPaired = useConnectionStore((s) => s.setPaired);

  const handlePair = async () => {
    const res = await api.pair(code);
    if (res.status === 200 && res.body?.success) {
      setPaired(true);
    } else {
      setError(res.body?.error ?? "Pairing failed");
    }
  };

  return (
    <div className="pair-page">
      <h2>Pair Device</h2>
      <p>Enter the 6-digit code from your terminal</p>
      <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
      <button onClick={handlePair}>Pair</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

**Step 2: Commit**

```
feat(web): add pairing page with code input
```

---

### Task 10: Connection banner component

**Files:**
- Create: `packages/web/src/components/ConnectionBanner.tsx`
- Create: `packages/web/src/styles/components.css`

**Step 1: Build ConnectionBanner**

Shows daemon + OpenCode connection status. Same as mobile's `ConnectionBanner.tsx`.

```tsx
export function ConnectionBanner() {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  const daemonConnected = useConnectionStore((s) => s.daemonConnected);
  const opencodeReady = useConnectionStore((s) => s.opencodeReady);

  if (wsConnected && daemonConnected && opencodeReady) return null;

  return (
    <div className="connection-banner">
      {!wsConnected && <span className="status-dot danger" />}
      {!daemonConnected && <span>Daemon disconnected</span>}
      {daemonConnected && !opencodeReady && <span>OpenCode starting...</span>}
    </div>
  );
}
```

**Step 2: Commit**

```
feat(web): add connection status banner
```

---

### Task 11: Session list page

**Files:**
- Modify: `packages/web/src/pages/SessionsPage.tsx`
- Create: `packages/web/src/components/SessionRow.tsx`
- Create: `packages/web/src/components/ProjectFilterBar.tsx`
- Create: `packages/web/src/styles/sessions.css`

**Step 1: Build SessionsPage**

Fetches sessions on mount, renders grouped by day (same as mobile).
- Project filter bar at top
- New session FAB / button
- Click session → navigate to `/chat/:id`

**Step 2: Build SessionRow**

Shows session title, project badge, preview, activity dot, relative time.

**Step 3: Build ProjectFilterBar**

Horizontal filter pills: "All" + one per unique project.

**Step 4: Wire up session creation**

"New Session" button calls `api.newSession(project)` and navigates to the new chat.

**Step 5: Commit**

```
feat(web): add session list with project filter and session rows
```

---

### Task 12: Chat page — message list + input

**Files:**
- Modify: `packages/web/src/pages/ChatPage.tsx`
- Create: `packages/web/src/components/MessageBubble.tsx`
- Create: `packages/web/src/components/ToolCallCard.tsx`
- Create: `packages/web/src/components/PermissionCard.tsx`
- Create: `packages/web/src/components/MarkdownContent.tsx`
- Create: `packages/web/src/styles/chat.css`

**Step 1: Build ChatPage**

- Fetches messages on mount via `api.messages(sessionId)`
- Renders message list with auto-scroll
- Text input bar at bottom with send button
- Handles optimistic send (add user message immediately, send via API)

**Step 2: Build MessageBubble**

- User messages: right-aligned, accent background
- Assistant messages: left-aligned, surface background
- Renders parts: text → MarkdownContent, tool-invocation → ToolCallCard
- Streaming indicator (pulsing dot) when `message.streaming`

**Step 3: Build MarkdownContent**

Uses `react-markdown` + `remark-gfm` for rendering.
Code blocks with syntax highlighting (just monospace + background for MVP).

**Step 4: Build ToolCallCard**

Collapsible card showing tool name, args, and result.
Same UX as mobile: header with tool name, expandable body.

**Step 5: Build PermissionCard**

Shows pending permission with Approve/Deny buttons.
Calls `api.approve()` / `api.deny()`.

**Step 6: Commit**

```
feat(web): add chat page with messages, tool cards, and permissions
```

---

### Task 13: Settings page

**Files:**
- Modify: `packages/web/src/pages/SettingsPage.tsx`
- Create: `packages/web/src/styles/settings.css`

**Step 1: Build SettingsPage**

Sections:
- Connection status (server URL, WS connected, daemon connected, OpenCode ready)
- Session mode toggle (build / plan)
- Verbosity toggle (standard / full)
- Sign out button
- Re-pair button

**Step 2: Commit**

```
feat(web): add settings page
```

---

### Task 14: Session config controls (abort, diff, revert)

**Files:**
- Create: `packages/web/src/components/SessionControls.tsx`
- Create: `packages/web/src/components/DiffView.tsx`
- Modify: `packages/web/src/pages/ChatPage.tsx` (add controls to header)

**Step 1: Build SessionControls**

Toolbar in the chat page header with:
- Abort button (stops current generation)
- View Diff button (opens diff modal)
- Revert button (with confirmation)

**Step 2: Build DiffView**

Modal showing file diffs. Renders patch text with +/- line coloring.

**Step 3: Commit**

```
feat(web): add session controls (abort, diff, revert)
```

---

### Task 15: Add web to root test script + final polish

**Files:**
- Modify: `packages/web/package.json` (ensure test script)
- Modify: `package.json` (add web to root test script)

**Step 1: Add web workspace to root test command**

**Step 2: Run all tests**

Run: `npm test` (from workspace root)
Expected: All workspaces pass

**Step 3: Update ROADMAP.md — mark Feature 1 as Done**

**Step 4: Final commit**

```
feat(web): complete web browser client (Feature 1)
```

---

## Commit Strategy

One commit per task (15 commits total). Each commit should leave the build in a working state.

## Testing Strategy

- **API client + event handler**: Node.js built-in test runner (ported from mobile tests)
- **Components**: Manual testing via dev server (component tests are YAGNI for MVP — the mobile tests cover the shared logic, and the web-specific code is mostly React rendering glue)
- **Integration**: Manual smoke test: login → pair → create session → send prompt → see streaming response → approve permission → view diff

## Estimated Scope

~15 files to create, ~1500 lines of TypeScript/CSS. Core logic (api, events, stores) is ported from mobile. New code is primarily React components and CSS.
