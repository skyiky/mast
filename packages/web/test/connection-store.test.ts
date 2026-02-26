/**
 * Tests for the Zustand connection store.
 *
 * Run: node --import tsx --test --test-force-exit test/connection-store.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useConnectionStore } from "../src/stores/connection.js";

describe("connection store", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useConnectionStore.setState({
      serverUrl: "",
      wsUrl: "",
      apiToken: "",
      authReady: false,
      wsConnected: false,
      daemonConnected: false,
      opencodeReady: false,
      paired: false,
    });
  });

  it("starts with empty defaults", () => {
    const state = useConnectionStore.getState();
    assert.equal(state.serverUrl, "");
    assert.equal(state.wsUrl, "");
    assert.equal(state.apiToken, "");
    assert.equal(state.authReady, false);
    assert.equal(state.wsConnected, false);
    assert.equal(state.daemonConnected, false);
    assert.equal(state.opencodeReady, false);
    assert.equal(state.paired, false);
  });

  it("setServerUrl derives wsUrl from http URL", () => {
    useConnectionStore.getState().setServerUrl("https://example.com:3000");
    const state = useConnectionStore.getState();
    assert.equal(state.serverUrl, "https://example.com:3000");
    assert.equal(state.wsUrl, "wss://example.com:3000");
  });

  it("setServerUrl derives wsUrl from http (non-TLS)", () => {
    useConnectionStore.getState().setServerUrl("http://localhost:3000");
    const state = useConnectionStore.getState();
    assert.equal(state.serverUrl, "http://localhost:3000");
    assert.equal(state.wsUrl, "ws://localhost:3000");
  });

  it("setApiToken updates token", () => {
    useConnectionStore.getState().setApiToken("tok-123");
    assert.equal(useConnectionStore.getState().apiToken, "tok-123");
  });

  it("setAuthReady updates authReady", () => {
    useConnectionStore.getState().setAuthReady(true);
    assert.equal(useConnectionStore.getState().authReady, true);
  });

  it("setWsConnected updates wsConnected", () => {
    useConnectionStore.getState().setWsConnected(true);
    assert.equal(useConnectionStore.getState().wsConnected, true);
  });

  it("setDaemonStatus updates both flags", () => {
    useConnectionStore.getState().setDaemonStatus(true, true);
    const state = useConnectionStore.getState();
    assert.equal(state.daemonConnected, true);
    assert.equal(state.opencodeReady, true);
  });

  it("setPaired updates paired", () => {
    useConnectionStore.getState().setPaired(true);
    assert.equal(useConnectionStore.getState().paired, true);
  });

  it("signOut clears auth state but preserves server config", () => {
    const store = useConnectionStore.getState();
    store.setServerUrl("https://example.com");
    store.setApiToken("tok-123");
    store.setWsConnected(true);
    store.setDaemonStatus(true, true);
    store.setPaired(true);

    useConnectionStore.getState().signOut();

    const state = useConnectionStore.getState();
    // Auth/connection state cleared
    assert.equal(state.apiToken, "");
    assert.equal(state.wsConnected, false);
    assert.equal(state.daemonConnected, false);
    assert.equal(state.opencodeReady, false);
    // Server config preserved
    assert.equal(state.serverUrl, "https://example.com");
    assert.equal(state.wsUrl, "wss://example.com");
    assert.equal(state.paired, true);
  });

  it("reset clears ALL state and sets authReady=true", () => {
    const store = useConnectionStore.getState();
    store.setServerUrl("https://example.com");
    store.setApiToken("tok-123");
    store.setPaired(true);

    useConnectionStore.getState().reset();

    const state = useConnectionStore.getState();
    assert.equal(state.serverUrl, "");
    assert.equal(state.wsUrl, "");
    assert.equal(state.apiToken, "");
    assert.equal(state.paired, false);
    assert.equal(state.authReady, true); // authReady set to true on reset
  });
});
