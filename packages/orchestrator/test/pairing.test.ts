/**
 * Phase 4 tests: Pairing flow
 *
 * Tests the 6-digit pairing code flow:
 *   1. Daemon connects with token=pairing, sends pair_request
 *   2. Phone submits code via POST /pair/verify
 *   3. Daemon receives pair_response with device key
 *   4. Daemon reconnects with issued key
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "../src/server.js";
import { PairingManager } from "../src/pairing.js";
import { createFakeOpenCode, type FakeOpenCode } from "./fake-opencode.js";
import { SemanticRelay } from "../../daemon/src/relay.js";
import { HARDCODED_API_TOKEN } from "@mast/shared";
import { apiRequest, sleep } from "./helpers.js";

describe("Pairing flow", () => {
  let server: ServerHandle;
  let pairingManager: PairingManager;
  let fakeOpenCode: FakeOpenCode;

  afterEach(async () => {
    if (server) await server.close();
    if (fakeOpenCode) await fakeOpenCode.close();
  });

  async function setup() {
    fakeOpenCode = await createFakeOpenCode();
    pairingManager = new PairingManager();
    server = await startServer(0, { pairingManager });
    return {
      baseUrl: `http://localhost:${server.port}`,
      wsUrl: `ws://localhost:${server.port}`,
    };
  }

  it("1. daemon connects with token=pairing, sends pair_request with 6-digit code", async () => {
    const { wsUrl } = await setup();

    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Send pairing request
    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "123456",
    }));

    await sleep(50);

    // Verify the pairing manager registered the code
    assert.equal(pairingManager.hasPending(), true);
    assert.equal(pairingManager.getPendingCode(), "123456");

    ws.close();
    await sleep(50);
  });

  it("2. POST /pair/verify with correct code returns device key", async () => {
    const { baseUrl, wsUrl } = await setup();

    // Daemon connects and sends pairing code
    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "654321",
    }));
    await sleep(50);

    // Phone verifies the code
    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "654321" });
    assert.equal(result.status, 200);

    const body = result.body as { success: boolean; deviceKey: string };
    assert.equal(body.success, true);
    assert.ok(body.deviceKey);
    assert.ok(body.deviceKey.startsWith("dk_"));

    ws.close();
    await sleep(50);
  });

  it("3. after successful pairing, daemon receives pair_response with success and device key", async () => {
    const { baseUrl, wsUrl } = await setup();

    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Collect messages from daemon WSS
    const messages: unknown[] = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "111111",
    }));
    await sleep(50);

    // Phone verifies
    await apiRequest(baseUrl, "POST", "/pair/verify", { code: "111111" });
    await sleep(50);

    // Daemon should have received pair_response
    const pairResponse = messages.find(
      (m: any) => m.type === "pair_response"
    ) as any;
    assert.ok(pairResponse, "daemon should receive pair_response");
    assert.equal(pairResponse.success, true);
    assert.ok(pairResponse.deviceKey);

    ws.close();
    await sleep(50);
  });

  it("4. daemon reconnects with issued device key, connection accepted", async () => {
    const { baseUrl, wsUrl } = await setup();

    // Step 1: Pair
    const pairingWs = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      pairingWs.on("open", () => resolve());
      pairingWs.on("error", reject);
    });

    const messages: any[] = [];
    pairingWs.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    pairingWs.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "222222",
    }));
    await sleep(50);

    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "222222" });
    const { deviceKey } = result.body as { deviceKey: string };
    pairingWs.close();
    await sleep(50);

    // Step 2: Reconnect with issued key
    const authedWs = new WebSocket(`${wsUrl}/daemon?token=${deviceKey}`);
    await new Promise<void>((resolve, reject) => {
      authedWs.on("open", () => resolve());
      authedWs.on("error", reject);
    });

    // Should be accepted (no error thrown)
    assert.equal(authedWs.readyState, WebSocket.OPEN);

    authedWs.close();
    await sleep(50);
  });

  it("5. POST /pair/verify with wrong code returns error", async () => {
    const { baseUrl, wsUrl } = await setup();

    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "333333",
    }));
    await sleep(50);

    // Submit wrong code
    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "999999" });
    assert.equal(result.status, 400);

    const body = result.body as { success: boolean; error: string };
    assert.equal(body.success, false);
    assert.equal(body.error, "invalid_code");

    ws.close();
    await sleep(50);
  });

  it("6. POST /pair/verify after 5-minute expiry returns code_expired error", async () => {
    const { baseUrl, wsUrl } = await setup();

    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "444444",
    }));
    await sleep(50);

    // Manually manipulate the creation time to simulate expiry
    // Access the private pending field for testing
    const pending = (pairingManager as any).pending;
    assert.ok(pending);
    pending.createdAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago

    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "444444" });
    assert.equal(result.status, 400);

    const body = result.body as { success: boolean; error: string };
    assert.equal(body.success, false);
    assert.equal(body.error, "code_expired");

    ws.close();
    await sleep(50);
  });

  it("7. new pair_request invalidates previous pending code", async () => {
    const { baseUrl, wsUrl } = await setup();

    // First daemon
    const ws1 = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws1.on("open", () => resolve());
      ws1.on("error", reject);
    });

    const ws1Messages: any[] = [];
    ws1.on("message", (data) => {
      ws1Messages.push(JSON.parse(data.toString()));
    });

    ws1.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "555555",
    }));
    await sleep(50);

    // Second daemon with new code
    const ws2 = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws2.on("open", () => resolve());
      ws2.on("error", reject);
    });

    ws2.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "666666",
    }));
    await sleep(50);

    // First code should be invalidated
    assert.equal(pairingManager.getPendingCode(), "666666");

    // The first daemon should have received a rejection
    const rejection = ws1Messages.find(
      (m: any) => m.type === "pair_response" && m.success === false
    );
    assert.ok(rejection, "first daemon should receive pair_response with success=false");

    // Trying first code fails
    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "555555" });
    assert.equal(result.status, 400);

    ws1.close();
    ws2.close();
    await sleep(50);
  });

  it("8. daemon disconnects before pairing completes, code is cleaned up", async () => {
    const { baseUrl, wsUrl } = await setup();

    const ws = new WebSocket(`${wsUrl}/daemon?token=pairing`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(JSON.stringify({
      type: "pair_request",
      pairingCode: "777777",
    }));
    await sleep(50);

    assert.equal(pairingManager.hasPending(), true);

    // Daemon disconnects
    ws.close();
    await sleep(100);

    // Pairing code should be cleaned up
    assert.equal(pairingManager.hasPending(), false);

    // Attempting to verify should fail
    const result = await apiRequest(baseUrl, "POST", "/pair/verify", { code: "777777" });
    assert.equal(result.status, 400);
    const body = result.body as { success: boolean; error: string };
    assert.equal(body.error, "no_pending_pairing");
  });
});
