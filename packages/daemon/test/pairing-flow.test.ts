import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket } from "ws";
import { runPairingFlow } from "../src/pairing-flow.js";
import type { PairResponse, PairRequest } from "@mast/shared";

describe("runPairingFlow", () => {
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    const addr = wss.address();
    port = typeof addr === "object" ? addr.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("sends pair_request and resolves with deviceKey on success", async () => {
    let receivedCode: string | null = null;

    wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as PairRequest;
        assert.equal(msg.type, "pair_request");
        assert.ok(msg.pairingCode.length === 6, "pairing code should be 6 digits");
        receivedCode = msg.pairingCode;

        // Simulate orchestrator sending pair_response
        const response: PairResponse = {
          type: "pair_response",
          success: true,
          deviceKey: "dk_test-device-key-123",
        };
        ws.send(JSON.stringify(response));
      });
    });

    const key = await runPairingFlow(`ws://localhost:${port}`);
    assert.equal(key, "dk_test-device-key-123");
    assert.ok(receivedCode !== null, "server should have received the pairing code");
  });

  it("rejects when pairing fails with error", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", () => {
        const response: PairResponse = {
          type: "pair_response",
          success: false,
          error: "code expired",
        };
        ws.send(JSON.stringify(response));
      });
    });

    await assert.rejects(
      () => runPairingFlow(`ws://localhost:${port}`),
      (err: Error) => {
        assert.match(err.message, /code expired/);
        return true;
      },
    );
  });

  it("rejects when connection fails", async () => {
    // Close server immediately so connection fails
    await new Promise<void>((resolve) => wss.close(() => resolve()));

    await assert.rejects(
      () => runPairingFlow(`ws://localhost:${port}`),
      (err: Error) => {
        assert.match(err.message, /connection failed/i);
        return true;
      },
    );
  });

  it("calls onDisplayCode callback with the generated code", async () => {
    let displayedCode: string | null = null;

    wss.on("connection", (ws) => {
      ws.on("message", () => {
        const response: PairResponse = {
          type: "pair_response",
          success: true,
          deviceKey: "dk_abc",
        };
        ws.send(JSON.stringify(response));
      });
    });

    await runPairingFlow(`ws://localhost:${port}`, {
      onDisplayCode: (code, _qrPayload) => {
        displayedCode = code;
      },
    });

    assert.ok(displayedCode !== null, "onDisplayCode should have been called");
    assert.equal(displayedCode!.length, 6);
  });
});
