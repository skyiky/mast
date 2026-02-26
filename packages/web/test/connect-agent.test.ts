import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveWssUrl } from "../src/lib/connect-agent.js";

describe("deriveWssUrl", () => {
  it("converts https to wss", () => {
    assert.equal(
      deriveWssUrl("https://mast-orchestrator.example.com"),
      "wss://mast-orchestrator.example.com",
    );
  });

  it("converts http to ws", () => {
    assert.equal(
      deriveWssUrl("http://localhost:3000"),
      "ws://localhost:3000",
    );
  });

  it("strips trailing slash", () => {
    assert.equal(
      deriveWssUrl("https://example.com/"),
      "wss://example.com",
    );
  });

  it("returns empty string for empty input", () => {
    assert.equal(deriveWssUrl(""), "");
  });

  it("builds the full CLI command", () => {
    const wssUrl = deriveWssUrl("https://mast-orchestrator.calmflower-ed9bbb2e.eastus.azurecontainerapps.io");
    assert.equal(
      wssUrl,
      "wss://mast-orchestrator.calmflower-ed9bbb2e.eastus.azurecontainerapps.io",
    );
  });
});
