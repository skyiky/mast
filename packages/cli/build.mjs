/**
 * Build script for @mast/cli.
 *
 * Bundles src/cli.ts → dist/cli.mjs as a self-contained ESM binary.
 * Native Node.js modules (fs, path, os, etc.) are left as external imports.
 * The `ws` package is also external since it has native bindings.
 */

import { build } from "esbuild";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";

const SHEBANG = "#!/usr/bin/env node\n";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // ws has optional native deps; keep it external.
  // @supabase/supabase-js is used by the orchestrator's Supabase store
  // (production only) — externalize to avoid bundling its large dep tree.
  external: ["ws", "@supabase/supabase-js"],
  // Banner doesn't work reliably for shebang — we'll prepend manually
  minify: false,
  sourcemap: false,
});

// Prepend shebang line for Unix compatibility
const bundled = readFileSync("dist/cli.mjs", "utf-8");
if (!bundled.startsWith("#!")) {
  writeFileSync("dist/cli.mjs", SHEBANG + bundled);
}

// Make executable on Unix
try {
  chmodSync("dist/cli.mjs", 0o755);
} catch {
  // Windows doesn't support chmod — that's fine
}

console.log("Built dist/cli.mjs");
