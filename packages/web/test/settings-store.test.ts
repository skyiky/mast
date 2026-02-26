/**
 * Tests for the Zustand settings store.
 *
 * Run: node --import tsx --test --test-force-exit test/settings-store.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useSettingsStore } from "../src/stores/settings.js";

describe("settings store", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      verbosity: "standard",
      theme: "terminal-dark",
      sessionMode: "build",
    });
  });

  it("starts with default values", () => {
    const state = useSettingsStore.getState();
    assert.equal(state.verbosity, "standard");
    assert.equal(state.theme, "terminal-dark");
    assert.equal(state.sessionMode, "build");
  });

  it("setVerbosity changes verbosity", () => {
    useSettingsStore.getState().setVerbosity("full");
    assert.equal(useSettingsStore.getState().verbosity, "full");
  });

  it("toggleVerbosity toggles between standard and full", () => {
    useSettingsStore.getState().toggleVerbosity();
    assert.equal(useSettingsStore.getState().verbosity, "full");
    useSettingsStore.getState().toggleVerbosity();
    assert.equal(useSettingsStore.getState().verbosity, "standard");
  });

  it("setTheme changes theme", () => {
    useSettingsStore.getState().setTheme("solarized");
    assert.equal(useSettingsStore.getState().theme, "solarized");
  });

  it("setSessionMode changes session mode", () => {
    useSettingsStore.getState().setSessionMode("plan");
    assert.equal(useSettingsStore.getState().sessionMode, "plan");
  });

  it("toggleSessionMode toggles between build and plan", () => {
    useSettingsStore.getState().toggleSessionMode();
    assert.equal(useSettingsStore.getState().sessionMode, "plan");
    useSettingsStore.getState().toggleSessionMode();
    assert.equal(useSettingsStore.getState().sessionMode, "build");
  });
});
