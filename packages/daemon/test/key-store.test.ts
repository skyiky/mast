/**
 * KeyStore Tests — Phase 5
 *
 * Tests device key persistence to disk.
 * Uses a temp directory instead of ~/.mast to avoid polluting the real home.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir, platform, homedir } from "node:os";
import { join } from "node:path";
import { KeyStore } from "../src/key-store.js";

let tempDir: string;
let keyStore: KeyStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "mast-test-keys-"));
  keyStore = new KeyStore(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// Test 10: saveDeviceKey writes key to file
// =============================================================================

describe("KeyStore", () => {
  it("10. save writes key to device-key.json", async () => {
    await keyStore.save("dk_test-key-123");

    // Verify the file was created
    const raw = await readFile(join(tempDir, "device-key.json"), "utf-8");
    const data = JSON.parse(raw);

    assert.equal(data.deviceKey, "dk_test-key-123");
    assert.ok(data.pairedAt, "Should have a pairedAt timestamp");

    // Verify pairedAt is a valid ISO 8601 date
    const date = new Date(data.pairedAt);
    assert.ok(!isNaN(date.getTime()), "pairedAt should be a valid date");
  });

  // ===========================================================================
  // Test 11: loadDeviceKey reads previously saved key
  // ===========================================================================

  it("11. load returns previously saved key", async () => {
    await keyStore.save("dk_round-trip-key");

    const loaded = await keyStore.load();
    assert.equal(loaded, "dk_round-trip-key");
  });

  // ===========================================================================
  // Test 12: loadDeviceKey returns null when no key file exists
  // ===========================================================================

  it("12. load returns null when no key file exists", async () => {
    const loaded = await keyStore.load();
    assert.equal(loaded, null);
  });

  // ===========================================================================
  // Test 13: clearDeviceKey removes the stored key
  // ===========================================================================

  it("13. clear removes the stored key", async () => {
    await keyStore.save("dk_to-be-cleared");

    // Verify it exists first
    assert.equal(await keyStore.exists(), true);

    // Clear it
    await keyStore.clear();

    // Verify it's gone
    assert.equal(await keyStore.exists(), false);
    assert.equal(await keyStore.load(), null);
  });

  // ===========================================================================
  // Test 14: Key file has restricted permissions on Unix
  // ===========================================================================

  it("14. key file has restricted permissions (600 on Unix)", async () => {
    if (platform() === "win32") {
      // Windows doesn't support Unix file permissions — skip
      return;
    }

    await keyStore.save("dk_permissions-test");

    const fileStat = await stat(join(tempDir, "device-key.json"));
    const mode = fileStat.mode & 0o777; // Mask to permission bits only
    assert.equal(
      mode,
      0o600,
      `File permissions should be 600 (owner read/write only), got ${mode.toString(8)}`
    );
  });

  // ===========================================================================
  // Additional: clear is idempotent (no error if file doesn't exist)
  // ===========================================================================

  it("clear is idempotent — no error when no file exists", async () => {
    // Should not throw
    await keyStore.clear();
    await keyStore.clear();
  });

  // ===========================================================================
  // Additional: load handles corrupt JSON gracefully
  // ===========================================================================

  it("load returns null for corrupt JSON", async () => {
    const { writeFile: writeF } = await import("node:fs/promises");
    await writeF(join(tempDir, "device-key.json"), "not valid json{{{", "utf-8");

    const loaded = await keyStore.load();
    assert.equal(loaded, null, "Should return null for corrupt JSON");
  });

  // ===========================================================================
  // Additional: load returns null for JSON missing deviceKey field
  // ===========================================================================

  it("load returns null for JSON missing deviceKey", async () => {
    const { writeFile: writeF } = await import("node:fs/promises");
    await writeF(
      join(tempDir, "device-key.json"),
      JSON.stringify({ pairedAt: "2026-01-01" }),
      "utf-8"
    );

    const loaded = await keyStore.load();
    assert.equal(loaded, null, "Should return null when deviceKey is missing");
  });
});

// =============================================================================
// Test 22: KeyStore path resolution uses correct platform-specific directory
// =============================================================================

describe("KeyStore path resolution", () => {
  it("22. default dir is ~/.mast", () => {
    const defaultDir = KeyStore.defaultDir();
    const home = homedir();
    assert.equal(defaultDir, join(home, ".mast"));
  });

  it("custom dir overrides default", () => {
    const custom = new KeyStore("/tmp/custom-mast");
    assert.equal(custom.dir, "/tmp/custom-mast");
    assert.equal(custom.file, join("/tmp/custom-mast", "device-key.json"));
  });
});
