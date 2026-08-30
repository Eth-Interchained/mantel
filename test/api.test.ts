/**
 * Live API suite — the REAL app against the REAL embedded engine.
 *
 * Boots createApp() on an ephemeral port over a scratch data dir. No mocks,
 * no daemon.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_api_${Date.now().toString(36)}_test`;
process.env.MANTEL_OPERATOR_TOKEN = "test-operator-token";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");

let server: Server;
let base: string;

const OPERATOR = { authorization: "Bearer test-operator-token", "content-type": "application/json" };

const MODEL = {
  id: "deepseek-r1:32b",
  name: "DeepSeek R1 32B",
  params: "32B",
  license: "MIT",
  arch: "qwen2",
  contextNative: 131072,
  pull: "hearth pull deepseek-r1:32b",
  summary: "Reasoning model, distilled onto a Qwen2 32B base.",
  tags: ["reasoning", "coder"],
  quants: [
    { name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 },
    { name: "Q8_0", fileGib: 34, minVramGib: 36 },
    { name: "FP16", fileGib: 64, minVramGib: null },
  ],
  links: { hf: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B" },
};

before(async () => {
  assert.ok(await db.ping(), "embedded engine must open");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server?.close();
  await db.dropDatabase();
});

test("health reports the embedded engine and its integrity", async () => {
  const r = await fetch(`${base}/api/health`);
  const j = (await r.json()) as {
    mantel: string;
    nedb: { ok: boolean; engine: string; verified: boolean; version?: string };
    ingestConfigured: boolean;
  };
  assert.equal(r.status, 200);
  assert.equal(j.mantel, "ok");
  assert.equal(j.nedb.ok, true);
  assert.equal(j.nedb.engine, "embedded-v2-dag");
  assert.equal(j.nedb.verified, true);
  assert.equal(j.ingestConfigured, true);
});

test("config exposes the reference hardware profiles", async () => {
  const r = await fetch(`${base}/api/config`);
  const j = (await r.json()) as { brandName: string; profiles: { id: string }[] };
  assert.equal(r.status, 200);
  assert.ok(j.profiles.length > 0);
  assert.ok(j.profiles.some((p) => p.id === "rtx-3090"));
});

test("an empty catalog says so instead of erroring", async () => {
  const r = await fetch(`${base}/api/models`);
  const j = (await r.json()) as { models: unknown[]; count: number };
  assert.equal(r.status, 200);
  assert.equal(j.count, 0);
});

test("a model is created through the operator route", async () => {
  const r = await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: OPERATOR,
    body: JSON.stringify(MODEL),
  });
  const j = (await r.json()) as { ok: boolean; id: string; hash: string };
  assert.equal(r.status, 201);
  assert.equal(j.ok, true);
  assert.equal(j.id, "deepseek-r1:32b");
  assert.match(j.hash, /^[0-9a-f]{16,}$/);
});

test("an invalid model id is rejected with the failing field named", async () => {
  const r = await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: OPERATOR,
    body: JSON.stringify({ ...MODEL, id: "no-colon-here" }),
  });
  assert.equal(r.status, 400);
  const j = (await r.json()) as { error: string; issues: { path: string[] }[] };
  assert.equal(j.error, "invalid model");
  assert.ok(j.issues.some((i) => i.path.includes("id")));
});

test("the model appears in the catalog listing", async () => {
  const r = await fetch(`${base}/api/models`);
  const j = (await r.json()) as { models: { _id: string }[]; count: number };
  assert.equal(j.count, 1);
  assert.equal(j.models[0]._id, "deepseek-r1:32b");
});

test("the model page returns the model plus its (empty) signal set", async () => {
  const r = await fetch(`${base}/api/models/deepseek-r1%3A32b`);
  const j = (await r.json()) as {
    model: { _id: string; name: string };
    signals: unknown[];
    signalCount: number;
  };
  assert.equal(r.status, 200);
  assert.equal(j.model._id, "deepseek-r1:32b");
  assert.equal(j.model.name, "DeepSeek R1 32B");
  assert.equal(j.signalCount, 0);
});

test("an unknown model is a 404, never an empty 200", async () => {
  const r = await fetch(`${base}/api/models/nope%3A1b`);
  assert.equal(r.status, 404);
  const j = (await r.json()) as { error: string };
  assert.equal(j.error, "unknown model");
});

test("fit reports every reference profile, and keeps FP16 unmeasured", async () => {
  const r = await fetch(`${base}/api/fit/deepseek-r1%3A32b`);
  const j = (await r.json()) as {
    fits: { profile: { id: string }; best: string; bestQuant: string | null; unmeasured: number }[];
  };
  assert.equal(r.status, 200);

  const rtx3090 = j.fits.find((f) => f.profile.id === "rtx-3090");
  assert.equal(rtx3090?.best, "fits");
  assert.equal(rtx3090?.bestQuant, "Q4_K_M");
  assert.equal(rtx3090?.unmeasured, 1, "FP16 has no measured figure and stays unmeasured");

  const small = j.fits.find((f) => f.profile.id === "rtx-3060-12");
  assert.equal(small?.best, "too-big");
});

test("fit against a raw VRAM figure works and explains itself", async () => {
  const r = await fetch(`${base}/api/fit/deepseek-r1%3A32b/40`);
  const j = (await r.json()) as {
    fit: { profile: { vramGib: number }; best: string; quants: { quant: string; reason: string }[] };
  };
  assert.equal(r.status, 200);
  assert.equal(j.fit.profile.vramGib, 40);
  assert.equal(j.fit.best, "fits");
  const fp16 = j.fit.quants.find((q) => q.quant === "FP16");
  assert.match(fp16?.reason ?? "", /NOT a substitute/, "the unmeasured quant states why");
});

test("an unknown fit profile is a 400 that lists the known ids", async () => {
  const r = await fetch(`${base}/api/fit/deepseek-r1%3A32b/banana`);
  assert.equal(r.status, 400);
  const j = (await r.json()) as { error: string; known: string[] };
  assert.equal(j.error, "unknown profile");
  assert.ok(j.known.includes("rtx-3090"));
});

test("the wire returns the latest signals across all models, newest first", async () => {
  // Seed three signals with distinct timestamps, two models, out of insert
  // order — the wire must sort by postedAt DESC, not by write order.
  const mk = (n: number, model: string, when: string) => ({
    signal: {
      modelRef: model,
      source: "hn" as const,
      sourceUrl: `https://news.ycombinator.com/item?id=wire${n}`,
      excerpt: `wire probe ${n}`,
      sentiment: "neutral" as const,
      postedAt: when,
    },
    raw: { capturedAt: "2026-08-30T00:00:00.000Z", body: "b" },
  });
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: OPERATOR,
    body: JSON.stringify({
      signals: [
        mk(1, "deepseek-r1:32b", "2026-08-10T00:00:00.000Z"),
        mk(3, "wiretest:1b", "2026-08-29T00:00:00.000Z"),
        mk(2, "deepseek-r1:32b", "2026-08-20T00:00:00.000Z"),
      ],
    }),
  });
  assert.equal(r.status, 201);

  const w = await fetch(`${base}/api/signals/latest?limit=3`);
  const j = (await w.json()) as { signals: { excerpt: string; postedAt: string }[]; count: number };
  assert.equal(w.status, 200);
  assert.equal(j.count, 3);
  assert.deepEqual(
    j.signals.map((x) => x.excerpt),
    ["wire probe 3", "wire probe 2", "wire probe 1"],
    "newest first by postedAt, across models, regardless of insert order",
  );
});

test("an unknown API path is a JSON 404, not the SPA shell", async () => {
  const r = await fetch(`${base}/api/does-not-exist`);
  assert.equal(r.status, 404);
  const j = (await r.json()) as { error: string };
  assert.equal(j.error, "unknown endpoint");
});
