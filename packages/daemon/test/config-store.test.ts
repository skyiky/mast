/**
 * ConfigStore Tests
 *
 * Tests persistent config storage to ~/.mast/config.json.
 * Uses a temp directory to avoid polluting the real home.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/config-store.js";

let tempDir: string;
let store: ConfigStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "mast-test-config-"));
  store = new ConfigStore(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ConfigStore", () => {
  it("save writes config to config.json", async () => {
    await store.save({ orchestratorUrl: "wss://example.com" });

    const raw = await readFile(join(tempDir, "config.json"), "utf-8");
    const data = JSON.parse(raw);

    assert.equal(data.orchestratorUrl, "wss://example.com");
  });

  it("load returns previously saved config", async () => {
    await store.save({ orchestratorUrl: "wss://test.io" });

    const config = await store.load();
    assert.equal(config.orchestratorUrl, "wss://test.io");
  });

  it("load returns empty object when no config file exists", async () => {
    const config = await store.load();
    assert.deepEqual(config, {});
  });

  it("load returns empty object for corrupt JSON", async () => {
    await writeFile(join(tempDir, "config.json"), "not valid json{{{", "utf-8");

    const config = await store.load();
    assert.deepEqual(config, {});
  });

  it("load returns empty object for non-object JSON", async () => {
    await writeFile(join(tempDir, "config.json"), '"just a string"', "utf-8");

    const config = await store.load();
    assert.deepEqual(config, {});
  });

  it("load returns empty object for JSON array", async () => {
    await writeFile(join(tempDir, "config.json"), "[1, 2, 3]", "utf-8");

    const config = await store.load();
    assert.deepEqual(config, {});
  });

  it("get returns a single value", async () => {
    await store.save({ orchestratorUrl: "wss://single.io" });

    const url = await store.get("orchestratorUrl");
    assert.equal(url, "wss://single.io");
  });

  it("get returns undefined for missing key", async () => {
    await store.save({});

    const url = await store.get("orchestratorUrl");
    assert.equal(url, undefined);
  });

  it("set merges with existing config", async () => {
    await store.save({ orchestratorUrl: "wss://original.io" });

    await store.set("orchestratorUrl", "wss://updated.io");

    const config = await store.load();
    assert.equal(config.orchestratorUrl, "wss://updated.io");
  });

  it("set creates config file if it does not exist", async () => {
    await store.set("orchestratorUrl", "wss://fresh.io");

    const config = await store.load();
    assert.equal(config.orchestratorUrl, "wss://fresh.io");
  });

  it("save creates directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "nested", "deep");
    const nested = new ConfigStore(nestedDir);

    await nested.save({ orchestratorUrl: "wss://nested.io" });

    const config = await nested.load();
    assert.equal(config.orchestratorUrl, "wss://nested.io");
  });
});

describe("ConfigStore path resolution", () => {
  it("default dir is ~/.mast", () => {
    const defaultDir = ConfigStore.defaultDir();
    assert.equal(defaultDir, join(homedir(), ".mast"));
  });

  it("custom dir overrides default", () => {
    const custom = new ConfigStore("/tmp/custom-mast");
    assert.equal(custom.dir, "/tmp/custom-mast");
    assert.equal(custom.file, join("/tmp/custom-mast", "config.json"));
  });
});
