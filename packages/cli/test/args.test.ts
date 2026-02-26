/**
 * CLI Argument Parsing Tests
 *
 * Tests parseCliArgs() — a pure function that converts argv to a CliConfig.
 *
 * Framework: node:test + node:assert (zero dependencies)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseCliArgs, type CliConfig } from "../src/args.js";

describe("parseCliArgs", () => {
  // ===========================================================================
  // Default behavior (no arguments)
  // ===========================================================================

  it("defaults to start command with cwd as directory", () => {
    const config = parseCliArgs([]);
    assert.equal(config.command, "start");
    assert.equal(config.directory, process.cwd());
    assert.equal(config.port, 4096);
    assert.equal(config.sandbox, false);
    assert.equal(config.orchestratorUrl, "");
  });

  // ===========================================================================
  // Positional argument (project directory)
  // ===========================================================================

  it("accepts a positional argument as project directory", () => {
    const config = parseCliArgs(["/home/user/my-project"]);
    assert.equal(config.command, "start");
    assert.equal(config.directory, resolve("/home/user/my-project"));
  });

  it("accepts a relative directory path", () => {
    const config = parseCliArgs(["./my-project"]);
    assert.equal(config.command, "start");
    // Should resolve relative to cwd
    assert.ok(config.directory.includes("my-project"));
    assert.ok(!config.directory.startsWith("./"));
  });

  // ===========================================================================
  // Named options
  // ===========================================================================

  it("--port sets custom OpenCode port", () => {
    const config = parseCliArgs(["--port", "5000"]);
    assert.equal(config.port, 5000);
  });

  it("--orchestrator sets custom orchestrator URL", () => {
    const config = parseCliArgs(["--orchestrator", "wss://my-server.com"]);
    assert.equal(config.orchestratorUrl, "wss://my-server.com");
  });

  it("--sandbox enables sandbox mode", () => {
    const config = parseCliArgs(["--sandbox"]);
    assert.equal(config.sandbox, true);
  });

  it("combines directory with named options", () => {
    const config = parseCliArgs(["/path/to/project", "--port", "8080", "--sandbox"]);
    assert.equal(config.directory, resolve("/path/to/project"));
    assert.equal(config.port, 8080);
    assert.equal(config.sandbox, true);
  });

  // ===========================================================================
  // Subcommands
  // ===========================================================================

  it("attach subcommand parses URL", () => {
    const config = parseCliArgs(["attach", "http://localhost:4096"]);
    assert.equal(config.command, "attach");
    assert.equal(config.attachUrl, "http://localhost:4096");
  });

  it("attach subcommand without URL throws", () => {
    assert.throws(
      () => parseCliArgs(["attach"]),
      { message: /url required/i }
    );
  });

  it("--help sets command to help", () => {
    const config = parseCliArgs(["--help"]);
    assert.equal(config.command, "help");
  });

  it("-h sets command to help", () => {
    const config = parseCliArgs(["-h"]);
    assert.equal(config.command, "help");
  });

  it("--version sets command to version", () => {
    const config = parseCliArgs(["--version"]);
    assert.equal(config.command, "version");
  });

  it("-v sets command to version", () => {
    const config = parseCliArgs(["-v"]);
    assert.equal(config.command, "version");
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  it("rejects unknown flags", () => {
    assert.throws(
      () => parseCliArgs(["--unknown-flag"]),
      /unknown/i
    );
  });

  it("rejects --port without a value", () => {
    assert.throws(
      () => parseCliArgs(["--port"]),
    );
  });

  it("rejects non-numeric port", () => {
    assert.throws(
      () => parseCliArgs(["--port", "abc"]),
      /invalid.*port/i
    );
  });
});
