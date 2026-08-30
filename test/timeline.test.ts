/**
 * Sentiment timeline suite — the shareable curve, against the real engine.
 *
 * The curve's honesty rests on two things: it buckets by when a post was MADE
 * (postedAt), not when we captured it, and every bucket is reconstructable
 * from the signals behind it. These tests hold both.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_timeline_${Date.now().toString(36)}_test`;
process.env.MANTEL_OPERATOR_TOKEN = "op";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");

let server: Server;
let base: string;
const OP = { authorization: "Bearer op", "content-type": "application/json" };

function sig(sentiment: string, postedAt: string, n: number) {
  return {
    signal: {
      modelRef: "tl:32b",
      source: "hn" as const,
      sourceUrl: `https://news.ycombinator.com/item?id=tl${n}`,
      excerpt: `signal ${n}`,
      sentiment,
      postedAt,
    },
    raw: { capturedAt: "2026-08-30T00:00:00.000Z", body: "b" },
  };
}

before(async () => {
  assert.ok(await db.ping());
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;

  await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: OP,
    body: JSON.stringify({ id: "tl:32b", name: "Timeline Test", quants: [] }),
  });

  // Three months, ingested OUT of chronological order to prove bucketing keys
  // on postedAt, not write order. June: mostly positive. July: mixed swing.
  // August: turns negative (the "tone shifted after v2" story).
  await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: OP,
    body: JSON.stringify({
      signals: [
        sig("negative", "2026-08-05T00:00:00.000Z", 1),
        sig("positive", "2026-06-10T00:00:00.000Z", 2),
        sig("positive", "2026-06-20T00:00:00.000Z", 3),
        sig("mixed", "2026-07-14T00:00:00.000Z", 4),
        sig("positive", "2026-07-02T00:00:00.000Z", 5),
        sig("negative", "2026-08-22T00:00:00.000Z", 6),
        sig("neutral", "2026-06-25T00:00:00.000Z", 7),
      ],
    }),
  });
});

after(async () => {
  server?.close();
  await db.dropDatabase();
});

test("the timeline buckets by posted month, in chronological order", async () => {
  const r = await fetch(`${base}/api/models/tl%3A32b/timeline`);
  const j = (await r.json()) as { timeline: { period: string }[] };
  assert.equal(r.status, 200);
  assert.deepEqual(
    j.timeline.map((b) => b.period),
    ["2026-06", "2026-07", "2026-08"],
    "months are ordered, regardless of ingest order",
  );
});

test("each bucket carries the exact per-sentiment counts and total", async () => {
  const r = await fetch(`${base}/api/models/tl%3A32b/timeline`);
  const { timeline } = (await r.json()) as {
    timeline: {
      period: string;
      positive: number;
      negative: number;
      mixed: number;
      neutral: number;
      total: number;
    }[];
  };
  const jun = timeline.find((b) => b.period === "2026-06");
  const jul = timeline.find((b) => b.period === "2026-07");
  const aug = timeline.find((b) => b.period === "2026-08");

  assert.deepEqual(
    { positive: jun?.positive, neutral: jun?.neutral, total: jun?.total },
    { positive: 2, neutral: 1, total: 3 },
  );
  assert.deepEqual(
    { positive: jul?.positive, mixed: jul?.mixed, total: jul?.total },
    { positive: 1, mixed: 1, total: 2 },
  );
  assert.deepEqual({ negative: aug?.negative, total: aug?.total }, { negative: 2, total: 2 });
});

test("the curve tells the tone-shift story: positive June, negative August", async () => {
  const r = await fetch(`${base}/api/models/tl%3A32b/timeline`);
  const { timeline } = (await r.json()) as {
    timeline: { period: string; positive: number; negative: number }[];
  };
  const jun = timeline.find((b) => b.period === "2026-06")!;
  const aug = timeline.find((b) => b.period === "2026-08")!;
  assert.ok(jun.positive > jun.negative, "June skews positive");
  assert.ok(aug.negative > aug.positive, "August skews negative — the shareable moment");
});

test("a bucket is reconstructable: total equals the signals in that month", async () => {
  // The receipt property. August's bucket says 2 — and querying August's
  // signals must return exactly those 2.
  const list = await fetch(`${base}/api/models/tl%3A32b/signals?limit=1000`);
  const { signals } = (await list.json()) as { signals: { postedAt: string }[] };
  const augCount = signals.filter((s) => s.postedAt.startsWith("2026-08")).length;

  const tl = await fetch(`${base}/api/models/tl%3A32b/timeline`);
  const { timeline } = (await tl.json()) as { timeline: { period: string; total: number }[] };
  const augBucket = timeline.find((b) => b.period === "2026-08");
  assert.equal(augBucket?.total, augCount, "the bar height matches the signals behind it");
});

test("an unknown model's timeline is a 404, not an empty 200", async () => {
  const r = await fetch(`${base}/api/models/nope%3A1b/timeline`);
  assert.equal(r.status, 404);
});

test("a model with no signals has an empty timeline, not an error", async () => {
  await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: OP,
    body: JSON.stringify({ id: "quiet:1b", name: "Quiet", quants: [] }),
  });
  const r = await fetch(`${base}/api/models/quiet%3A1b/timeline`);
  const j = (await r.json()) as { timeline: unknown[] };
  assert.equal(r.status, 200);
  assert.deepEqual(j.timeline, []);
});
