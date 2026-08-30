/**
 * Reviews suite — the social write path.
 *
 * A review is a signal with source "mantel", authored by a derived identity.
 * These tests hold the properties that make that safe and useful: reviews
 * appear as signals everywhere, they carry a provenance chain, re-posting
 * updates in place, and the rate limit bounds abuse without an account system.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_reviews_${Date.now().toString(36)}_test`;
process.env.MANTEL_OPERATOR_TOKEN = "op-token";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { deriveIdentity } = await import("../src/server/identity");
const { _resetRateLimiter } = await import("../src/server/reviews");

let server: Server;
let base: string;

const id = deriveIdentity("reviewer", "my-secret-salt");

function review(over: Record<string, unknown> = {}) {
  return {
    modelRef: "deepseek-r1:32b",
    identityHash: id.hash,
    handle: id.handle,
    body: "Q4 runs great on my 3090 — about 28 tok/s and the reasoning is worth the wait.",
    sentiment: "positive",
    hardware: "RTX 3090",
    ...over,
  };
}

before(async () => {
  assert.ok(await db.ping());
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;

  // The catalog entry the reviews target — the model PAGE 404s without it,
  // even though the review write itself does not require it.
  const seed = await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: { authorization: "Bearer op-token", "content-type": "application/json" },
    body: JSON.stringify({
      id: "deepseek-r1:32b",
      name: "DeepSeek R1 32B",
      quants: [{ name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 }],
    }),
  });
  assert.equal(seed.status, 201, "catalog seed must succeed before the review tests");
});

beforeEach(() => {
  // Each test starts with a clean limiter so ordering never causes a 429.
  _resetRateLimiter();
});

after(async () => {
  server?.close();
  await db.dropDatabase();
});

test("a review posts without any operator token — this is a public write", async () => {
  const r = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review()),
  });
  const j = (await r.json()) as { ok: boolean; signalId: string; handle: string };
  assert.equal(r.status, 201);
  assert.equal(j.ok, true);
  assert.match(j.signalId, /^sig_review_[0-9a-f]{32}$/);
  assert.equal(j.handle, id.handle);
});

test("the review shows up as a signal on the model, tagged mantel", async () => {
  const list = await fetch(`${base}/api/models/deepseek-r1%3A32b/signals`);
  const { signals } = (await list.json()) as {
    signals: { source: string; authorHandle: string; excerpt: string }[];
  };
  const mine = signals.find((s) => s.authorHandle === id.handle);
  assert.ok(mine, "the review is in the model's signal list");
  assert.equal(mine.source, "mantel");
  assert.match(mine.excerpt, /28 tok\/s/);
});

test("the review carries a provenance chain back to its author record", async () => {
  const list = await fetch(`${base}/api/models/deepseek-r1%3A32b/signals`);
  const { signals } = (await list.json()) as { signals: { _id: string; source: string }[] };
  const mine = signals.find((s) => s.source === "mantel");
  assert.ok(mine);

  const t = await fetch(
    `${base}/api/models/deepseek-r1%3A32b/signals/${encodeURIComponent(mine._id)}/trace`,
  );
  const j = (await t.json()) as { trace: { _coll: string }[]; depth: number };
  assert.equal(t.status, 200);
  assert.ok(j.depth >= 2, "chain reaches past the signal");
  assert.ok(
    j.trace.some((row) => row._coll === "source_documents"),
    "the authoring record is the review's provenance root",
  );
});

test("re-posting from the same identity updates in place, no duplicate", async () => {
  const first = await fetch(`${base}/api/models/deepseek-r1%3A32b/signals`);
  const before = ((await first.json()) as { signals: unknown[] }).signals.length;

  const r = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review({ body: "Edited: still great, now measured 30 tok/s at Q4." })),
  });
  assert.equal(r.status, 201);

  const after2 = await fetch(`${base}/api/models/deepseek-r1%3A32b/signals`);
  const { signals } = (await after2.json()) as {
    signals: { authorHandle: string; excerpt: string }[];
  };
  assert.equal(signals.length, before, "count unchanged — the review was updated, not added");
  const mine = signals.find((s) => s.authorHandle === id.handle);
  assert.match(mine?.excerpt ?? "", /30 tok\/s/, "content reflects the edit");
});

test("a malformed identity hash is rejected with the field named", async () => {
  const r = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review({ identityHash: "not-a-hash" })),
  });
  assert.equal(r.status, 400);
  const j = (await r.json()) as { error: string; issues: { path: string[] }[] };
  assert.equal(j.error, "invalid review");
  assert.ok(j.issues.some((i) => i.path.includes("identityHash")));
});

test("an empty body is rejected", async () => {
  const r = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review({ body: "" })),
  });
  assert.equal(r.status, 400);
});

test("the rate limit stops runaway posting from one identity on one model", async () => {
  // A distinct identity so the earlier tests' posts don't count against this.
  const spammer = deriveIdentity("spammer", "salt");
  const post = (n: number) =>
    fetch(`${base}/api/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        review({
          identityHash: spammer.hash,
          handle: spammer.handle,
          body: `spam attempt number ${n} padded to clear the minimum length`,
        }),
      ),
    });

  // 6 allowed per window, then 429. (Re-posts upsert one row; the limiter
  // counts attempts, not rows — abuse is about request volume.)
  const statuses: number[] = [];
  for (let i = 1; i <= 7; i++) statuses.push((await post(i)).status);
  assert.equal(statuses.filter((s) => s === 201).length, 6, "six posts allowed");
  assert.equal(statuses[6], 429, "the seventh is rate limited");
});

test("reviews and crawled signals share one sentiment tally", async () => {
  // The model page's tally must count a mantel review alongside crawled ones —
  // a review IS a signal, not a parallel system.
  const r = await fetch(`${base}/api/models/deepseek-r1%3A32b`);
  const j = (await r.json()) as { sentiment: Record<string, number> };
  assert.ok((j.sentiment.positive ?? 0) >= 1, "the positive review is in the tally");
});
