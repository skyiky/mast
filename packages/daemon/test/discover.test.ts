import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { discoverOpenCode } from "../src/discover.js";

/**
 * Helper: spin up a fake OpenCode server on a given port that responds
 * to GET /global/health with 200 JSON.
 */
function fakeOpenCode(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/global/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function closeServer(srv: Server): Promise<void> {
  return new Promise((resolve) => srv.close(() => resolve()));
}

describe("discoverOpenCode", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const srv of servers) {
      await closeServer(srv);
    }
    servers.length = 0;
  });

  it("finds a single OpenCode instance in the port range", async () => {
    const port = 44100;
    servers.push(await fakeOpenCode(port));

    const results = await discoverOpenCode([port, port]);
    assert.equal(results.length, 1);
    assert.equal(results[0].port, port);
    assert.equal(results[0].url, `http://localhost:${port}`);
  });

  it("finds multiple OpenCode instances", async () => {
    const ports = [44200, 44201, 44202];
    for (const p of ports) {
      servers.push(await fakeOpenCode(p));
    }

    const results = await discoverOpenCode([44200, 44202]);
    assert.equal(results.length, 3);
    const foundPorts = results.map((r) => r.port).sort();
    assert.deepEqual(foundPorts, [44200, 44201, 44202]);
  });

  it("returns empty array when no instances found", async () => {
    // Scan a range with nothing listening
    const results = await discoverOpenCode([44300, 44302]);
    assert.equal(results.length, 0);
  });

  it("skips ports that return non-200", async () => {
    const port = 44400;
    // Server that always returns 500
    const srv = createServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((resolve) => srv.listen(port, "127.0.0.1", () => resolve()));
    servers.push(srv);

    const results = await discoverOpenCode([port, port]);
    assert.equal(results.length, 0);
  });

  it("uses default port range when none specified", async () => {
    // Just verify the function accepts no arguments (uses defaults)
    // This will scan 4096..4110 — likely empty in test env
    const results = await discoverOpenCode();
    assert.ok(Array.isArray(results));
  });

  it("handles timeout gracefully for slow ports", async () => {
    const port = 44500;
    // Server that never responds
    const srv = createServer(() => {
      // intentionally never call res.end()
    });
    await new Promise<void>((resolve) => srv.listen(port, "127.0.0.1", () => resolve()));
    servers.push(srv);

    const results = await discoverOpenCode([port, port], 200);
    assert.equal(results.length, 0);
  });
});
