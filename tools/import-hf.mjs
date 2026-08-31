#!/usr/bin/env node
/**
 * HuggingFace GGUF importer — real catalog supply for GGUF repos that are not
 * in the Ollama library. No key needed for public repos.
 *
 * For each { repo, id } in the seed list this reads the PUBLIC HF API:
 *   /api/models/<repo>              -> gguf {architecture, context_length, total},
 *                                      cardData.license, tags
 *   /api/models/<repo>/tree/main    -> per-file sizes (bytes), incl. shards
 * and POSTs one catalog entry per repo to mantel's operator-gated
 * /api/ingest/model. Multi-part GGUFs are summed per quant.
 *
 * WHAT THIS NEVER DOES: set minVramGib. HF knows file sizes, not load
 * footprints. Every quant lands minVramGib: null = "unmeasured".
 *
 * The pure transforms live in import-hf-lib.mjs and are unit-tested.
 *
 * Usage:
 *   MANTEL_URL=http://127.0.0.1:3210 MANTEL_OPERATOR_TOKEN=... \
 *     node tools/import-hf.mjs [seed-hf.json]
 *
 * Optional HF_TOKEN env raises the anonymous rate limit; not required.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildHfEntry, groupGgufsByQuant } from "./import-hf-lib.mjs";

const HF = "https://huggingface.co";
const MANTEL = process.env.MANTEL_URL || "http://127.0.0.1:3001";
const TOKEN = process.env.MANTEL_OPERATOR_TOKEN;

if (!TOKEN) {
  console.error(
    "[import-hf] MANTEL_OPERATOR_TOKEN is not set — the ingest route would refuse " +
      "every write, so this run would only waste HF bandwidth. Aborting.",
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(process.argv[2] || join(here, "seed-hf.json"));
const seeds = JSON.parse(readFileSync(seedPath, "utf8"));

const hfHeaders = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {};

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const head = (await r.text()).slice(0, 200);
    throw new Error(`${url} -> ${r.status} ${head}`);
  }
  return r.json();
}

async function postModel(model) {
  const r = await fetch(`${MANTEL}/api/ingest/model`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(model),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`ingest ${model.id} -> ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

let ok = 0;
let failed = 0;

for (const seed of seeds) {
  if (!seed || typeof seed.repo !== "string" || typeof seed.id !== "string") {
    console.error(`[import-hf] skipping malformed seed (needs {repo, id}): ${JSON.stringify(seed)}`);
    failed++;
    continue;
  }
  try {
    const meta = await getJson(`${HF}/api/models/${seed.repo}`, hfHeaders);
    const tree = await getJson(
      `${HF}/api/models/${seed.repo}/tree/main?recursive=true`,
      hfHeaders,
    );
    const { quants, skipped } = groupGgufsByQuant(Array.isArray(tree) ? tree : []);
    for (const s of skipped) {
      console.warn(`[import-hf] ${seed.repo}: skipped unparseable/zero-size GGUF ${s}`);
    }
    if (quants.length === 0) {
      failed++;
      console.error(`[import-hf] ${seed.repo}: no usable GGUF quant found — not writing an entry`);
      continue;
    }
    const entry = buildHfEntry(seed, meta, quants);
    const res = await postModel(entry);
    ok++;
    console.log(
      `[import-hf] wrote ${entry.id}  (${quants.length} quant(s): ` +
        `${quants.map((q) => q.name).join(", ")}, seq ${res.seq})`,
    );
  } catch (err) {
    failed++;
    console.error(`[import-hf] FAILED ${seed.repo}: ${err.message}`);
  }
}

console.log(`[import-hf] done: ${ok} written, ${failed} failed`);
// Nonzero exit on any failure so a scheduled run cannot silently half-work.
process.exit(failed === 0 ? 0 : 1);
