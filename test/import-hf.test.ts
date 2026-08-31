/**
 * HF importer transform suite — quant parsing and multi-part merging on
 * captured HF API shapes. No network: the live API is exercised by running the
 * tool, but the LOGIC is pinned here.
 *
 * Fixtures are real shapes captured from huggingface.co on 2026-08-30.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error — plain ESM helper module, no d.ts, intentional.
import {
  buildHfEntry,
  formatParams,
  groupGgufsByQuant,
  parseQuantFromFilename,
} from "../tools/import-hf-lib.mjs";

test("parseQuantFromFilename reads the quant vocabulary, not the last dash", () => {
  assert.equal(parseQuantFromFilename("DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(parseQuantFromFilename("Qwen2.5-Coder-7B-Instruct-Q8_0.gguf"), "Q8_0");
  assert.equal(parseQuantFromFilename("model-Q2_K_L.gguf"), "Q2_K_L");
  assert.equal(parseQuantFromFilename("model-IQ3_XXS.gguf"), "IQ3_XXS");
  assert.equal(parseQuantFromFilename("model-Q4_0.gguf"), "Q4_0");
});

test("parseQuantFromFilename handles multi-part shard suffixes", () => {
  assert.equal(
    parseQuantFromFilename("DeepSeek-R1-Distill-Qwen-32B-F16/DeepSeek-R1-Distill-Qwen-32B-F16-00001-of-00002.gguf"),
    "F16",
  );
  assert.equal(parseQuantFromFilename("m-BF16-00002-of-00003.gguf"), "BF16");
});

test("parseQuantFromFilename returns null for a non-quant file", () => {
  assert.equal(parseQuantFromFilename("README.md"), null);
  assert.equal(parseQuantFromFilename(".gitattributes"), null);
  assert.equal(parseQuantFromFilename("mmproj-model-f16.gguf"), "F16"); // vision proj still carries a quant token
});

test("groupGgufsByQuant sums multi-part shards into one quant row", () => {
  const tree = [
    { path: "m-F16/m-F16-00001-of-00002.gguf", size: 35_004_569_440 },
    { path: "m-F16/m-F16-00002-of-00002.gguf", size: 30_531_399_936 },
    { path: "m-Q4_K_M.gguf", size: 19_851_335_584 },
    { path: "README.md", size: 1000 },
    { path: ".gitattributes", size: 100 },
  ];
  const { quants, skipped } = groupGgufsByQuant(tree);
  const f16 = quants.find((q: { name: string }) => q.name === "F16");
  const q4 = quants.find((q: { name: string }) => q.name === "Q4_K_M");
  // (35004569440 + 30531399936) / 1024^3 = 61.04 GiB
  assert.equal(f16.fileGib, 61.04);
  assert.equal(q4.fileGib, 18.49);
  assert.equal(skipped.length, 0, "non-gguf files are ignored, not counted as skipped quants");
});

test("groupGgufsByQuant NEVER sets a minVramGib", () => {
  const { quants } = groupGgufsByQuant([{ path: "m-Q4_K_M.gguf", size: 1_000_000_000 }]);
  assert.equal(quants[0].minVramGib, null, "HF supplies file size, never a VRAM figure");
});

test("groupGgufsByQuant reports (does not silently drop) unparseable and zero-size GGUFs", () => {
  const { quants, skipped } = groupGgufsByQuant([
    { path: "weird-name.gguf", size: 5_000_000_000 },
    { path: "m-Q4_K_M.gguf", size: 0 },
    { path: "m-Q8_0.gguf", size: 8_000_000_000 },
  ]);
  assert.equal(quants.length, 1, "only the one usable quant is emitted");
  assert.equal(quants[0].name, "Q8_0");
  assert.ok(skipped.includes("weird-name.gguf"), "unparseable quant is reported");
  assert.ok(skipped.includes("m-Q4_K_M.gguf"), "zero-size gguf is reported, not a 0 GiB quant");
});

test("groupGgufsByQuant sorts quants by size ascending", () => {
  const { quants } = groupGgufsByQuant([
    { path: "m-Q8_0.gguf", size: 8_000_000_000 },
    { path: "m-Q2_K.gguf", size: 2_000_000_000 },
    { path: "m-Q4_K_M.gguf", size: 4_000_000_000 },
  ]);
  assert.deepEqual(quants.map((q: { name: string }) => q.name), ["Q2_K", "Q4_K_M", "Q8_0"]);
});

test("formatParams renders a human count or nothing, never a fake zero", () => {
  assert.equal(formatParams(32_763_876_352), "32.8B");
  assert.equal(formatParams(7_600_000_000), "7.6B");
  assert.equal(formatParams(500_000_000), "500M");
  assert.equal(formatParams(0), undefined);
  assert.equal(formatParams(undefined), undefined);
  assert.equal(formatParams(-5), undefined);
});

test("buildHfEntry lets registry facts win and drops undefined keys", () => {
  const meta = {
    gguf: { total: 32_763_876_352, architecture: "qwen2", context_length: 131072 },
    cardData: { license: "apache-2.0" },
  };
  const entry = buildHfEntry(
    {
      repo: "unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF",
      id: "deepseek-r1-distill:32b-gguf",
      name: "DeepSeek R1 Distill 32B",
      tags: ["reasoning"],
      summary: "test",
    },
    meta,
    [{ name: "Q4_K_M", fileGib: 18.49, minVramGib: null }],
  );
  assert.equal(entry.id, "deepseek-r1-distill:32b-gguf");
  assert.equal(entry.params, "32.8B");
  assert.equal(entry.arch, "qwen2");
  assert.equal(entry.license, "apache-2.0");
  assert.equal(entry.contextNative, 131072);
  assert.equal(entry.links.hf, "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF");
  assert.equal(entry.pull, "hearth pull deepseek-r1-distill:32b-gguf");
  for (const [k, v] of Object.entries(entry)) {
    assert.notEqual(v, undefined, `key ${k} must not be undefined`);
  }
});

test("buildHfEntry: an explicit seed license overrides the card license", () => {
  const entry = buildHfEntry(
    { repo: "x/y", id: "a:b", license: "MIT" },
    { gguf: {}, cardData: { license: "apache-2.0" } },
    [{ name: "Q4_K_M", fileGib: 1, minVramGib: null }],
  );
  assert.equal(entry.license, "MIT");
});
