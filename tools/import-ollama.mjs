#!/usr/bin/env node
/**
 * Ollama registry importer — real catalog supply, no invented numbers.
 *
 * For each family:tag in the seed list this reads the PUBLIC registry
 * (registry.ollama.ai, no key):
 *
 *   manifest  -> the model layer's exact byte size        -> fileGib
 *   config    -> file_type (the quant, e.g. "Q4_K_M"),
 *                model_type (params, e.g. "32.8B"),
 *                model_family (arch)
 *
 * and POSTs one catalog entry per family to mantel's operator-gated
 * /api/ingest/model. Several tags of one family merge into one entry with one
 * quant row per tag.
 *
 * WHAT THIS NEVER DOES: set minVramGib. The registry knows file sizes, not
 * load footprints. Every imported quant lands minVramGib: null =
 * "unmeasured", and stays that way until a measured figure (hearth) exists.
 *
 * The pure transforms live in import-lib.mjs and are unit-tested; this file is
 * the fetch + POST shell around them.
 *
 * Usage:
 *   MANTEL_URL=http://127.0.0.1:3001 MANTEL_OPERATOR_TOKEN=... \
 *     node tools/import-ollama.mjs [seed-file.json]
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEntry, dedupeQuants, groupSeeds, tagFactsFrom } from "./import-lib.mjs";

const REGISTRY = "https://registry.ollama.ai";
const MANTEL = process.env.MANTEL_URL || "http://127.0.0.1:3001";
const TOKEN = process.env.MANTEL_OPERATOR_TOKEN;

if (!TOKEN) {
  console.error(
    "[import] MANTEL_OPERATOR_TOKEN is not set — the ingest route would refuse " +
      "every write, so this run would only waste registry bandwidth. Aborting.",
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(process.argv[2] || join(here, "seed-models.json"));
const seeds = JSON.parse(readFileSync(seedPath, "utf8"));

async function getJson(url, accept) {
  const r = await fetch(url, { headers: accept ? { accept } : {} });
  if (!r.ok) {
    const head = (await r.text()).slice(0, 200);
    throw new Error(`${url} -> ${r.status} ${head}`);
  }
  return r.json();
}

async function fetchTagFacts(family, tag) {
  const lib = family.includes("/") ? family : `library/${family}`;
  const manifest = await getJson(
    `${REGISTRY}/v2/${lib}/manifests/${tag}`,
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  const config = await getJson(`${REGISTRY}/v2/${lib}/blobs/${manifest.config.digest}`);
  return tagFactsFrom(manifest, config);
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

const { byFamily, skipped } = groupSeeds(seeds);
for (const bad of skipped) {
  console.error(`[import] skipping malformed seed "${bad}" — expected family:tag`);
}

let ok = 0;
let failed = skipped.length;

for (const [family, { meta, tags }] of byFamily) {
  const quants = [];
  let params;
  let arch;

  for (const tag of tags) {
    try {
      const f = await fetchTagFacts(family, tag);
      quants.push({ name: f.quant, fileGib: f.fileGib, minVramGib: null });
      params = params || f.params;
      arch = arch || f.arch;
      console.log(
        `[import] ${family}:${tag}  ${f.quant}  ${f.fileGib} GiB` +
          (f.params ? `  (${f.params})` : ""),
      );
    } catch (err) {
      failed++;
      console.error(`[import] FAILED ${family}:${tag}: ${err.message}`);
    }
  }

  if (quants.length === 0) {
    failed++;
    console.error(`[import] ${family}: no tag succeeded — not writing an empty entry`);
    continue;
  }

  const entry = buildEntry(family, tags[0], meta, dedupeQuants(quants), params, arch);
  try {
    const res = await postModel(entry);
    ok++;
    console.log(`[import] wrote ${entry.id}  (${entry.quants.length} quant(s), seq ${res.seq})`);
  } catch (err) {
    failed++;
    console.error(`[import] FAILED writing ${entry.id}: ${err.message}`);
  }
}

console.log(`[import] done: ${ok} written, ${failed} failed`);
// Nonzero exit on any failure so a cron/tick run cannot silently half-work.
process.exit(failed === 0 ? 0 : 1);
