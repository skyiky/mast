/**
 * Auto-detect Tests
 *
 * Tests autoDetect() — detects project from cwd, creates first-run config.
 * Uses real filesystem (temp dirs), no mocks.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { autoDetect, type DetectedProject } from "../src/auto-detect.js";

let tempDir: string;
let projectDir: string;
let configDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `mast-test-autodetect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  projectDir = join(tempDir, "my-project");
  configDir = join(tempDir, "config");
  await mkdir(projectDir, { recursive: true });
  // configDir is NOT created — autoDetect should handle first-run
});

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

describe("autoDetect", () => {
  // ===========================================================================
  // First-run (no config exists)
  // ===========================================================================

  it("creates projects.json on first run with cwd as the project", async () => {
    const result = await autoDetect({ directory: projectDir, configDir });

    assert.equal(result.name, "my-project");
    assert.equal(result.directory, projectDir);
    assert.equal(result.isNew, true);

    // Verify projects.json was written
    const raw = await readFile(join(configDir, "projects.json"), "utf-8");
    const data = JSON.parse(raw);
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].name, "my-project");
    assert.equal(data.projects[0].directory, projectDir);
  });

  it("uses directory basename as project name", async () => {
    const customDir = join(tempDir, "awesome-repo");
    await mkdir(customDir, { recursive: true });

    const result = await autoDetect({ directory: customDir, configDir });
    assert.equal(result.name, "awesome-repo");
  });

  // ===========================================================================
  // Existing config with matching project
  // ===========================================================================

  it("returns existing project when directory already in config", async () => {
    // Pre-create config with this project
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "projects.json"),
      JSON.stringify({
        projects: [{ name: "my-project", directory: projectDir }],
      }),
      "utf-8",
    );

    const result = await autoDetect({ directory: projectDir, configDir });
    assert.equal(result.name, "my-project");
    assert.equal(result.directory, projectDir);
    assert.equal(result.isNew, false);
  });

  it("matches project by directory even if name differs", async () => {
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "projects.json"),
      JSON.stringify({
        projects: [{ name: "custom-name", directory: projectDir }],
      }),
      "utf-8",
    );

    const result = await autoDetect({ directory: projectDir, configDir });
    assert.equal(result.name, "custom-name");
    assert.equal(result.isNew, false);
  });

  // ===========================================================================
  // Existing config without matching project
  // ===========================================================================

  it("adds new project to existing config when directory not present", async () => {
    const otherDir = join(tempDir, "other-project");
    await mkdir(otherDir, { recursive: true });

    // Pre-create config with a different project
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "projects.json"),
      JSON.stringify({
        projects: [{ name: "other-project", directory: otherDir }],
      }),
      "utf-8",
    );

    const result = await autoDetect({ directory: projectDir, configDir });
    assert.equal(result.name, "my-project");
    assert.equal(result.directory, projectDir);
    assert.equal(result.isNew, true);

    // Verify config now has both projects
    const raw = await readFile(join(configDir, "projects.json"), "utf-8");
    const data = JSON.parse(raw);
    assert.equal(data.projects.length, 2);
  });

  // ===========================================================================
  // Name deduplication
  // ===========================================================================

  it("deduplicates name when basename conflicts with existing project", async () => {
    // Create another "my-project" at a different path
    const conflictDir = join(tempDir, "elsewhere", "my-project");
    await mkdir(conflictDir, { recursive: true });

    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "projects.json"),
      JSON.stringify({
        projects: [{ name: "my-project", directory: conflictDir }],
      }),
      "utf-8",
    );

    const result = await autoDetect({ directory: projectDir, configDir });
    // Name should be deduplicated (e.g., "my-project-2")
    assert.notEqual(result.name, "my-project");
    assert.ok(result.name.startsWith("my-project"));
    assert.equal(result.directory, projectDir);
    assert.equal(result.isNew, true);
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  it("handles corrupt config file gracefully", async () => {
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "projects.json"), "not json!!!", "utf-8");

    // Should treat as first-run, overwrite corrupt file
    const result = await autoDetect({ directory: projectDir, configDir });
    assert.equal(result.name, "my-project");
    assert.equal(result.isNew, true);
  });

  it("throws if directory does not exist", async () => {
    const missingDir = join(tempDir, "nonexistent");
    await assert.rejects(
      () => autoDetect({ directory: missingDir, configDir }),
      /does not exist|not found|no such/i,
    );
  });
});
