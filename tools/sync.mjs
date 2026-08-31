#!/usr/bin/env node
/**
 * One-command idempotent catalog sync — the script Mark runs (or crons).
 *
 *   MANTEL_URL=... MANTEL_OPERATOR_TOKEN=... npm run sync
 *
 * Runs, in order:
 *   1. import-ollama.mjs                    (curated Ollama families)
 *   2. import-hf.mjs --discover N           (curated HF repos + top-N GGUF
 *                                            repos on HF by downloads)
 *
 * Idempotent by construction: every write is content-addressed by model id,
 * so re-running updates rows in place and never duplicates. Safe to run on a
 * timer.
 *
 * MANTEL_DISCOVER (default 50) sets N. Exit code is nonzero if EITHER step
 * failed — a cron cannot silently half-sync.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const discover = Number(process.env.MANTEL_DISCOVER || 50);

if (!process.env.MANTEL_OPERATOR_TOKEN) {
  console.error("[sync] MANTEL_OPERATOR_TOKEN is not set — nothing can be written. Aborting.");
  process.exit(1);
}

function run(label, args) {
  console.log(`\n[sync] ── ${label} ──`);
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`[sync] ${label} exited ${r.status}`);
    return false;
  }
  return true;
}

const okOllama = run("ollama (curated families)", [join(here, "import-ollama.mjs")]);
const okHf = run(`huggingface (curated + top ${discover} by downloads)`, [
  join(here, "import-hf.mjs"),
  "--discover",
  String(discover),
]);

if (okOllama && okHf) {
  console.log("\n[sync] done: both sources synced clean");
  process.exit(0);
}
console.error("\n[sync] finished WITH FAILURES — see the step logs above");
process.exit(1);
