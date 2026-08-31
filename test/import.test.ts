/**
 * Importer transform suite — the parsing and merging, on captured registry
 * fixtures. No network: the live registry is exercised by running the tool,
 * but the LOGIC must be pinned here so a registry-shape change or a refactor
 * fails a test instead of silently corrupting the catalog.
 *
 * Fixtures are real shapes captured from registry.ollama.ai on 2026-08-30.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error — plain ESM helper module, no d.ts, intentional.
import { buildEntry, dedupeQuants, groupSeeds, tagFactsFrom } from "../tools/import-lib.mjs";

const MANIFEST = {
  schemaVersion: 2,
  config: { digest: "sha256:abc", size: 488 },
  layers: [
    { mediaType: "application/vnd.ollama.image.model", digest: "sha256:m", size: 20_200_000_000 },
    { mediaType: "application/vnd.ollama.image.license", digest: "sha256:l", size: 100 },
  ],
};
const CONFIG = {
  model_format: "gguf",
  model_family: "qwen3",
  model_type: "32.8B",
  file_type: "Q4_K_M",
};

test("tagFactsFrom pulls quant, size, params and arch from real shapes", () => {
  const f = tagFactsFrom(MANIFEST, CONFIG);
  assert.equal(f.quant, "Q4_K_M");
  assert.equal(f.params, "32.8B");
  assert.equal(f.arch, "qwen3");
  // 20.2e9 bytes / 1024^3 = 18.81 GiB
  assert.equal(f.fileGib, 18.81);
});

test("tagFactsFrom NEVER yields a minVramGib — file size is not a footprint", () => {
  const f = tagFactsFrom(MANIFEST, CONFIG);
  assert.equal("minVramGib" in f, false, "the importer must not invent a VRAM figure");
});

test("tagFactsFrom throws when the model layer is absent", () => {
  const noModel = { ...MANIFEST, layers: [MANIFEST.layers[1]] };
  assert.throws(() => tagFactsFrom(noModel, CONFIG), /no model layer/);
});

test("tagFactsFrom throws when the quant name is missing", () => {
  const noType = { ...CONFIG, file_type: undefined };
  assert.throws(() => tagFactsFrom(MANIFEST, noType), /no file_type/);
});

test("groupSeeds merges tags of one family and reports malformed rows", () => {
  const { byFamily, skipped } = groupSeeds([
    { model: "qwen3:32b", name: "Qwen3 32B" },
    { model: "qwen3:14b" },
    { model: "deepseek-r1:8b" },
    { model: "no-colon" },
    { model: "trailing:" },
  ]);
  assert.deepEqual([...byFamily.get("qwen3").tags], ["32b", "14b"]);
  assert.equal(byFamily.get("qwen3").meta.name, "Qwen3 32B", "first row supplies the prose");
  assert.deepEqual([...byFamily.get("deepseek-r1").tags], ["8b"]);
  assert.deepEqual(skipped, ["no-colon", "trailing:"], "bad rows are reported, not kept");
});

test("dedupeQuants drops identical (name,size) pairs, keeps order", () => {
  const out = dedupeQuants([
    { name: "Q4_K_M", fileGib: 18.5, minVramGib: null },
    { name: "Q4_K_M", fileGib: 18.5, minVramGib: null },
    { name: "Q8_0", fileGib: 34, minVramGib: null },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((q: { name: string }) => q.name), ["Q4_K_M", "Q8_0"]);
});

test("buildEntry composes a clean payload with no undefined keys", () => {
  const entry = buildEntry(
    "qwen3",
    "32b",
    { name: "Qwen3 32B", license: "Apache-2.0", tags: ["chat"], hf: "https://hf.co/Qwen/Qwen3-32B" },
    [{ name: "Q4_K_M", fileGib: 18.81, minVramGib: null }],
    "32.8B",
    "qwen3",
  );
  assert.equal(entry.id, "qwen3:32b");
  assert.equal(entry.pull, "hearth pull qwen3:32b");
  assert.equal(entry.links.hf, "https://hf.co/Qwen/Qwen3-32B");
  assert.equal(entry.links.ollama, "https://ollama.com/library/qwen3");
  // No undefined values leaked into the payload.
  assert.ok(!JSON.stringify(entry).includes("null") || entry.quants[0].minVramGib === null);
  for (const [k, v] of Object.entries(entry)) {
    assert.notEqual(v, undefined, `key ${k} must not be undefined`);
  }
});

test("buildEntry falls back to family name and bare ollama link when meta is sparse", () => {
  const entry = buildEntry("phi4", "14b", {}, [{ name: "Q4_K_M", fileGib: 8.43, minVramGib: null }]);
  assert.equal(entry.name, "phi4");
  assert.equal(entry.links.hf, undefined);
  assert.equal(entry.links.ollama, "https://ollama.com/library/phi4");
  assert.deepEqual(entry.tags, []);
});
