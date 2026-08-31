/**
 * Feeds live suite — ranking against the real engine.
 *
 * Holds the two properties that make a VRAM-constrained feed honest:
 * only models PROVEN to fit are ranked, and models excluded for lack of a
 * measured VRAM figure are counted and surfaced, never silently dropped.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_feeds_${Date.now().toString(36)}_test`;
process.env.MANTEL_OPERATOR_TOKEN = "op";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");

let server: Server;
let base: string;
const OP = { authorization: "Bearer op", "content-type": "application/json" };

async function model(id: string, tags: string[], quants: unknown[]) {
  const r = await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: OP,
    body: JSON.stringify({ id, name: id, tags, quants }),
  });
  assert.equal(r.status, 201, `seed ${id}`);
}

async function signals(modelRef: string, sentiments: string[]) {
  const entries = sentiments.map((s, i) => ({
    signal: {
      modelRef,
      source: "hn" as const,
      sourceUrl: `https://news.ycombinator.com/item?id=${modelRef}-${i}`,
      excerpt: `signal ${i} for ${modelRef}`,
      sentiment: s,
      postedAt: `2026-08-2${i % 9}T00:00:00.000Z`,
    },
    raw: { capturedAt: "2026-08-30T00:00:00.000Z", body: "b" },
  }));
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: OP,
    body: JSON.stringify({ signals: entries }),
  });
  assert.equal(r.status, 201, `signals for ${modelRef}`);
}

before(async () => {
  assert.ok(await db.ping());
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;

  // A fits-easily coder with a big positive track record.
  await model("coder-good:14b", ["coder"], [{ name: "Q4_K_M", fileGib: 8, minVramGib: 10 }]);
  await signals("coder-good:14b", ["positive", "positive", "positive", "positive", "positive", "mixed"]);

  // A coder that also fits but has weaker sentiment.
  await model("coder-meh:14b", ["coder"], [{ name: "Q4_K_M", fileGib: 8, minVramGib: 12 }]);
  await signals("coder-meh:14b", ["positive", "negative", "mixed"]);

  // A coder too big for a 20GB feed.
  await model("coder-huge:70b", ["coder"], [{ name: "Q4_K_M", fileGib: 40, minVramGib: 45 }]);
  await signals("coder-huge:70b", ["positive", "positive"]);

  // A coder whose only quant is UNMEASURED — cannot be proven to fit.
  await model("coder-unknown:20b", ["coder"], [{ name: "Q4_K_M", fileGib: 12, minVramGib: null }]);
  await signals("coder-unknown:20b", ["positive", "positive", "positive"]);
});

after(async () => {
  server?.close();
  await db.dropDatabase();
});

test("the feed menu lists the curated feeds", async () => {
  const r = await fetch(`${base}/api/feeds`);
  const j = (await r.json()) as { feeds: { id: string }[] };
  assert.equal(r.status, 200);
  assert.ok(j.feeds.some((f) => f.id === "coder-under-20"));
});

test("best coder under 20GB ranks fitting models by evidence", async () => {
  const r = await fetch(`${base}/api/feeds/coder-under-20`);
  const j = (await r.json()) as {
    ranked: { id: string; score: number }[];
    excludedUnmeasured: number;
  };
  assert.equal(r.status, 200);
  const ids = j.ranked.map((x) => x.id);

  assert.equal(ids[0], "coder-good:14b", "the strong track record ranks first");
  assert.ok(ids.includes("coder-meh:14b"), "the weaker but fitting model is listed");
  assert.ok(!ids.includes("coder-huge:70b"), "the 70B does not fit 20GB and is excluded");
  assert.ok(
    !ids.includes("coder-unknown:20b"),
    "the unmeasured model cannot be proven to fit and is not ranked",
  );
});

test("models excluded for lack of measurement are counted, not hidden", async () => {
  const r = await fetch(`${base}/api/feeds/coder-under-20`);
  const j = (await r.json()) as { excludedUnmeasured: number };
  assert.equal(j.excludedUnmeasured, 1, "the one unmeasured coder is reported as excluded");
});

test("scores are ordered descending", async () => {
  const r = await fetch(`${base}/api/feeds/coder-under-20`);
  const j = (await r.json()) as { ranked: { score: number }[] };
  for (let i = 1; i < j.ranked.length; i++) {
    assert.ok(j.ranked[i - 1].score >= j.ranked[i].score, "each row scores <= the one above");
  }
});

test("a ?vram override changes who fits", async () => {
  // At 48GB the 70B coder now fits and should appear.
  const r = await fetch(`${base}/api/feeds/coder-under-20?vram=48`);
  const j = (await r.json()) as { ranked: { id: string }[]; feed: { vramGib: number } };
  assert.equal(j.feed.vramGib, 48);
  assert.ok(j.ranked.some((x) => x.id === "coder-huge:70b"), "the 70B fits a 48GB ceiling");
});

test("an unknown feed is a 404 that lists the known ids", async () => {
  const r = await fetch(`${base}/api/feeds/nope`);
  assert.equal(r.status, 404);
  const j = (await r.json()) as { error: string; known: string[] };
  assert.equal(j.error, "unknown feed");
  assert.ok(j.known.includes("coder-under-20"));
});

test("an invalid vram override is a 400", async () => {
  const r = await fetch(`${base}/api/feeds/coder-under-20?vram=-5`);
  assert.equal(r.status, 400);
});
