import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

describe("static file serving", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-static-test");

  // Create temp dist directory with test files
  it("serves index.html at /", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.includes("<html>test</html>"));
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves assets from subdirectories", async () => {
    mkdirSync(join(tmpDir, "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");
    writeFileSync(join(tmpDir, "assets", "app.js"), "console.log('hi')");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/assets/app.js`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(body, "console.log('hi')");
      const contentType = res.headers.get("content-type");
      assert.ok(contentType?.includes("application/javascript"));
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns index.html for SPA routes (client-side routing)", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>spa</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/sessions/abc`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.includes("<html>spa</html>"));
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("API routes still take priority over static files", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not serve static files when webDistPath is not set", async () => {
    const handle = await startServer(0, { devMode: true });

    try {
      const res = await fetch(`http://localhost:${handle.port}/`);
      // Should be 404, not 200 (no static files configured)
      assert.equal(res.status, 404);
    } finally {
      await handle.close();
    }
  });

  it("prevents path traversal", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      const res = await fetch(`http://localhost:${handle.port}/../../../package.json`);
      // Should NOT serve files outside the webDistPath
      // Either 404 or index.html (SPA fallback), but NOT the actual package.json
      const body = await res.text();
      assert.ok(!body.includes('"name"'), "Should not serve files outside webDistPath");
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves static files without auth while API routes require auth", async () => {
    mkdirSync(join(tmpDir, "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html>test</html>");
    writeFileSync(join(tmpDir, "assets", "app.css"), "body { color: red }");

    const handle = await startServer(0, {
      devMode: true,
      webDistPath: tmpDir,
    });

    try {
      // Static file: no auth needed
      const staticRes = await fetch(`http://localhost:${handle.port}/assets/app.css`);
      assert.equal(staticRes.status, 200);
      const body = await staticRes.text();
      assert.equal(body, "body { color: red }");

      // API route (POST): auth still required (POST to /sessions without bearer = 401)
      const apiRes = await fetch(`http://localhost:${handle.port}/sessions`, {
        method: "POST",
      });
      assert.equal(apiRes.status, 401);
    } finally {
      await handle.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
