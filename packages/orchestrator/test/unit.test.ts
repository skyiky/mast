/**
 * Phase 1 Unit Tests
 *
 * Tests isolated units that can't easily be covered by integration tests.
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateRequestId } from "@mast/shared";
import { DaemonConnection } from "../src/daemon-connection.js";

// =============================================================================
// generateRequestId
// =============================================================================

describe("generateRequestId", () => {
  it("1. returns unique UUIDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    assert.equal(ids.size, 1000, "All 1000 IDs should be unique");
  });

  it("returns valid UUID format", () => {
    const id = generateRequestId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(id, uuidRegex, `${id} should be a valid UUID v4`);
  });
});

// =============================================================================
// DaemonConnection
// =============================================================================

describe("DaemonConnection", () => {
  it("2. clearConnection rejects all pending requests", async () => {
    const conn = new DaemonConnection();

    // We need a real WebSocket-like object to set the connection.
    // Create a minimal mock that just satisfies the type checker.
    const fakeWs = {
      send: (_data: string) => {},
      readyState: 1, // OPEN
    };

    // Use type assertion since we just need minimal ws behavior
    conn.setConnection(fakeWs as any);

    // Send two requests that will be pending
    const p1 = conn.sendRequest("GET", "/test1");
    const p2 = conn.sendRequest("GET", "/test2");

    // Now clear the connection — should reject both
    conn.clearConnection();

    // Both promises should reject with "Daemon disconnected"
    await assert.rejects(p1, { message: "Daemon disconnected" });
    await assert.rejects(p2, { message: "Daemon disconnected" });
  });

  it("3. sendRequest rejects when not connected", async () => {
    const conn = new DaemonConnection();
    await assert.rejects(
      conn.sendRequest("GET", "/test"),
      { message: "Daemon not connected" },
    );
  });

  it("isConnected returns false initially", () => {
    const conn = new DaemonConnection();
    assert.equal(conn.isConnected(), false);
  });

  it("isConnected returns true after setConnection", () => {
    const conn = new DaemonConnection();
    const fakeWs = { send: () => {}, readyState: 1 };
    conn.setConnection(fakeWs as any);
    assert.equal(conn.isConnected(), true);
  });

  it("isConnected returns false after clearConnection", () => {
    const conn = new DaemonConnection();
    const fakeWs = { send: () => {}, readyState: 1 };
    conn.setConnection(fakeWs as any);
    conn.clearConnection();
    assert.equal(conn.isConnected(), false);
  });
});
