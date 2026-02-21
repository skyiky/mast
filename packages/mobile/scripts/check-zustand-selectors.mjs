/**
 * Lint script: detect unstable Zustand selectors.
 *
 * Zustand v5 uses React's useSyncExternalStore under the hood. If a selector
 * returns a new reference on every call (e.g. `?? []` or `?? {}`), React
 * detects the snapshot changed, re-renders, gets a new reference again, and
 * loops infinitely with:
 *
 *   "Maximum update depth exceeded"
 *   "The result of getSnapshot should be cached"
 *
 * Fix: wrap the selector with `useShallow` from `zustand/react/shallow`.
 *
 * This script scans all .ts/.tsx files for Zustand store selectors that
 * contain `?? []` or `?? {}` without a `useShallow` wrapper on the same line.
 *
 * Usage:  node scripts/check-zustand-selectors.mjs
 * Exit 1 if violations found, exit 0 if clean.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Patterns
const STORE_CALL = /use\w+Store\(/;
const UNSTABLE_DEFAULT = /\?\?\s*(\[\]|\{\})/;
const HAS_USE_SHALLOW = /useShallow/;

// Directories to skip
const SKIP = new Set(["node_modules", "dist", ".expo", "assets"]);

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const violations = [];

for (const file of walk(ROOT)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only flag lines that call a Zustand store AND have an unstable default
    if (STORE_CALL.test(line) && UNSTABLE_DEFAULT.test(line) && !HAS_USE_SHALLOW.test(line)) {
      violations.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\n  Unstable Zustand selectors found (${violations.length}):\n`,
  );
  console.error(
    "  Selectors returning ?? [] or ?? {} without useShallow() will cause",
  );
  console.error(
    "  infinite re-render loops in Zustand v5. Wrap with useShallow().\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}\n`);
  }
  console.error(
    "  Fix: useStore(useShallow((s) => s.thing ?? []))\n",
  );
  process.exit(1);
} else {
  console.log("  Zustand selector check passed — no unstable defaults found.");
  process.exit(0);
}
