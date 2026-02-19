/**
 * Test helpers: spin up the full relay stack for integration tests.
 *
 * Stack: Test runner (HTTP) -> Orchestrator (ephemeral port) -> Daemon Relay (WSS) -> Fake OpenCode (ephemeral port)
 * Phase 2: Test runner also connects as phone WSS client to receive streamed events.
 * Phase 3: Stack gains SessionStore + PushNotifier for cache and push tests.
 */

import { startServer, type ServerHandle } from "../src/server.js";
import { Relay } from "../../daemon/src/relay.js";
import { createFakeOpenCode, type FakeOpenCode } from "./fake-opencode.js";
import { InMemorySessionStore, type SessionStore } from "../src/session-store.js";
import {
  PushNotifier,
  PushDeduplicator,
  type PushConfig,
} from "../src/push-notifications.js";
import { createFakeExpoPush, type FakeExpoPush } from "./fake-expo-push.js";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import WebSocket from "ws";

export interface TestStack {
  orchestrator: ServerHandle;
  relay: Relay;
  fakeOpenCode: FakeOpenCode;
  /** Base URL for HTTP requests to orchestrator */
  baseUrl: string;
  /** Teardown everything */
  close(): Promise<void>;
}

export interface Phase3TestStack extends TestStack {
  store: InMemorySessionStore;
  pushNotifier: PushNotifier;
  fakeExpoPush: FakeExpoPush;
  deduplicator: PushDeduplicator;
}

/**
 * Start the full stack: fake OpenCode, orchestrator, daemon relay.
 * All on ephemeral ports.
 */
export async function startStack(): Promise<TestStack> {
  // 1. Start fake OpenCode
  const fakeOpenCode = await createFakeOpenCode();

  // 2. Start orchestrator on port 0 (ephemeral)
  const orchestrator = await startServer(0);

  // 3. Start daemon relay connecting to orchestrator, pointing at fake OpenCode
  const relay = new Relay(
    `ws://localhost:${orchestrator.port}`,
    fakeOpenCode.baseUrl,
  );
  await relay.connect();

  // Small delay to let the orchestrator register the daemon connection
  // and daemon's SSE subscriber to connect to fake OpenCode
  await sleep(100);

  const baseUrl = `http://localhost:${orchestrator.port}`;

  return {
    orchestrator,
    relay,
    fakeOpenCode,
    baseUrl,
    async close() {
      await relay.disconnect();
      await orchestrator.close();
      await fakeOpenCode.close();
    },
  };
}

/**
 * Start the full stack with Phase 3 additions: session store, push notifier, fake Expo push.
 */
export async function startPhase3Stack(opts?: {
  workingIntervalMs?: number;
  disconnectGraceMs?: number;
}): Promise<Phase3TestStack> {
  // 1. Start fake services
  const fakeOpenCode = await createFakeOpenCode();
  const fakeExpoPush = await createFakeExpoPush();

  // 2. Create session store + push infrastructure
  const store = new InMemorySessionStore();
  const deduplicator = new PushDeduplicator({
    workingIntervalMs: opts?.workingIntervalMs ?? 5 * 60 * 1000,
    disconnectGraceMs: opts?.disconnectGraceMs ?? 30 * 1000,
  });

  // 3. Start orchestrator — pushConfig.isPhoneConnected is wired after we have the handle
  let phoneConnectedFn = () => false;
  const pushConfig: PushConfig = {
    pushApiUrl: fakeExpoPush.url,
    isPhoneConnected: () => phoneConnectedFn(),
  };
  const pushNotifier = new PushNotifier(store, pushConfig, deduplicator);

  const orchestrator = await startServer(0, { store, pushNotifier });

  // Wire the phone connected check to the actual orchestrator
  phoneConnectedFn = () => orchestrator.phoneConnections.count() > 0;

  // 4. Start daemon relay
  const relay = new Relay(
    `ws://localhost:${orchestrator.port}`,
    fakeOpenCode.baseUrl,
  );
  await relay.connect();

  await sleep(100);

  const baseUrl = `http://localhost:${orchestrator.port}`;

  return {
    orchestrator,
    relay,
    fakeOpenCode,
    fakeExpoPush,
    store,
    pushNotifier,
    deduplicator,
    baseUrl,
    async close() {
      deduplicator.reset();
      await relay.disconnect();
      await orchestrator.close();
      await fakeOpenCode.close();
      await fakeExpoPush.close();
    },
  };
}

/**
 * Connect a phone WebSocket client to the orchestrator.
 * Returns the WebSocket and a helper to collect received messages.
 */
export async function connectPhone(port: number): Promise<{
  ws: WebSocket;
  messages: () => unknown[];
  close: () => Promise<void>;
}> {
  const ws = new WebSocket(
    `ws://localhost:${port}/ws?token=${HARDCODED_API_TOKEN}`,
  );

  const received: unknown[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });

  ws.on("message", (data) => {
    try {
      received.push(JSON.parse(data.toString()));
    } catch {
      received.push(data.toString());
    }
  });

  return {
    ws,
    messages: () => [...received],
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.on("close", () => resolve());
        ws.close();
      }),
  };
}

/** Make an authenticated request to the orchestrator */
export async function apiRequest(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${HARDCODED_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  let parsed: unknown;
  if (text.length === 0) {
    parsed = null;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

/** Make an unauthenticated request to the orchestrator */
export async function unauthRequest(
  baseUrl: string,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { method });
  const text = await res.text();
  let parsed: unknown;
  if (text.length === 0) {
    parsed = null;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
