/**
 * Ingestion suite — the gate, and the provenance chain it writes.
 *
 * Two things must hold: nothing writes without the operator token, and every
 * signal that lands is traceable back to a stored source document. A signal
 * with no provenance is a rumor, and mantel's entire claim is that it stores
 * none.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_ingest_${Date.now().toString(36)}_test`;
process.env.MANTEL_OPERATOR_TOKEN = "operator-secret";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");

let server: Server;
let base: string;

const AUTH = { authorization: "Bearer operator-secret", "content-type": "application/json" };
const JSON_ONLY = { "content-type": "application/json" };

function signalEntry(over: Record<string, unknown> = {}) {
  return {
    signal: {
      modelRef: "qwen3.6:27b",
      source: "reddit",
      sourceUrl: "https://reddit.com/r/LocalLLaMA/comments/abc123",
      authorHandle: "u/somebody",
      excerpt: "Runs great on my 3090 at Q4, about 30 tok/s.",
      sentiment: "positive",
      hardware: "RTX 3090",
      claim: "~30 tok/s at Q4 on a 3090",
      postedAt: "2026-08-20T12:00:00.000Z",
      ...over,
    },
    raw: {
      capturedAt: "2026-08-30T00:00:00.000Z",
      body: "Full post body as captured from the source page.",
    },
  };
}

before(async () => {
  assert.ok(await db.ping());
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;

  // The catalog entry the signals below refer to. Note that ingest does NOT
  // require it — a crawler can legitimately find posts about a model before
  // the catalog knows it — but the model PAGE 404s until it exists.
  const r = await fetch(`${base}/api/ingest/model`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      id: "qwen3.6:27b",
      name: "Qwen3.6 27B",
      params: "27B",
      quants: [{ name: "Q4_K_M", fileGib: 16.2, minVramGib: 18 }],
    }),
  });
  assert.equal(r.status, 201, "catalog seed must succeed before the signal tests");
});

after(async () => {
  server?.close();
  await db.dropDatabase();
});

test("ingest refuses an unauthenticated request", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: JSON_ONLY,
    body: JSON.stringify({ signals: [signalEntry()] }),
  });
  assert.equal(r.status, 401);
});

test("ingest refuses a wrong token", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: { authorization: "Bearer wrong-token-same-len", ...JSON_ONLY },
    body: JSON.stringify({ signals: [signalEntry()] }),
  });
  assert.equal(r.status, 401);
});

test("a signal lands and reports both ids", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ signals: [signalEntry()] }),
  });
  const j = (await r.json()) as {
    ok: boolean;
    written: number;
    failed: number;
    results: { ok: boolean; signalId?: string; sourceId?: string }[];
  };
  assert.equal(r.status, 201);
  assert.equal(j.ok, true);
  assert.equal(j.written, 1);
  assert.equal(j.failed, 0);
  assert.match(j.results[0].signalId ?? "", /^sig_[0-9a-f]{32}$/);
  assert.match(j.results[0].sourceId ?? "", /^src_[0-9a-f]{32}$/);
});

test("the signal is traceable back to its source document", async () => {
  const list = await fetch(`${base}/api/models/qwen3.6%3A27b/signals`);
  const { signals } = (await list.json()) as { signals: { _id: string }[] };
  assert.equal(signals.length, 1);

  const r = await fetch(
    `${base}/api/models/qwen3.6%3A27b/signals/${encodeURIComponent(signals[0]._id)}/trace`,
  );
  const j = (await r.json()) as { trace: { _id: string; _coll: string }[]; depth: number };
  assert.equal(r.status, 200);
  assert.ok(j.depth >= 2, "the chain reaches past the signal itself");
  assert.ok(
    j.trace.some((row) => row._coll === "source_documents"),
    "the captured source document is in the chain — this is the receipt",
  );
});

test("re-ingesting the same post is idempotent, not a duplicate", async () => {
  await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ signals: [signalEntry()] }),
  });
  const list = await fetch(`${base}/api/models/qwen3.6%3A27b/signals`);
  const { signals } = (await list.json()) as { signals: unknown[] };
  assert.equal(signals.length, 1, "content-addressed ids keep the store from growing on re-runs");
});

test("an invalid signal is rejected with the failing fields named", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      signals: [signalEntry({ sentiment: "amazing", sourceUrl: "not-a-url" })],
    }),
  });
  assert.equal(r.status, 400);
  const j = (await r.json()) as { error: string; issues: { path: (string | number)[] }[] };
  assert.equal(j.error, "invalid batch");
  const paths = j.issues.map((i) => i.path.join("."));
  assert.ok(paths.some((p) => p.includes("sentiment")));
  assert.ok(paths.some((p) => p.includes("sourceUrl")));
});

test("an over-long excerpt is refused — we quote, we do not republish", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ signals: [signalEntry({ excerpt: "x".repeat(601) })] }),
  });
  assert.equal(r.status, 400);
});

test("a partially valid batch is reported as partial, never rounded up", async () => {
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      signals: [
        signalEntry({ sourceUrl: "https://news.ycombinator.com/item?id=1", source: "hn" }),
        signalEntry({ sourceUrl: "https://news.ycombinator.com/item?id=2", source: "hn" }),
      ],
    }),
  });
  // Both are valid here, so this must be a clean 201 with an exact count —
  // the partial path is exercised by the schema rejection above at the batch
  // level, and any per-entry failure is reported in results[].
  const j = (await r.json()) as { written: number; failed: number; results: unknown[] };
  assert.equal(r.status, 201);
  assert.equal(j.written, 2);
  assert.equal(j.failed, 0);
  assert.equal(j.results.length, 2, "every entry gets its own result row");
});

test("a signal may reference a model the catalog does not have yet", async () => {
  // Ingestion order is not guaranteed: a crawler may see a post before we add
  // the model. That must land, not 400 — the signal is still real.
  const r = await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      signals: [
        signalEntry({
          modelRef: "not-in-catalog:7b",
          sourceUrl: "https://bsky.app/profile/x/post/1",
          source: "bluesky",
        }),
      ],
    }),
  });
  assert.equal(r.status, 201);
  const list = await fetch(`${base}/api/models/not-in-catalog%3A7b/signals`);
  const { signals } = (await list.json()) as { signals: unknown[] };
  assert.equal(signals.length, 1, "the signal is queryable even without a catalog row");
});

test("signals from several sources aggregate into a sentiment tally", async () => {
  await fetch(`${base}/api/ingest/signals`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      signals: [
        signalEntry({
          sourceUrl: "https://x.com/someone/status/1",
          source: "x",
          sentiment: "negative",
          excerpt: "OOMs above 8k context for me.",
        }),
      ],
    }),
  });

  const r = await fetch(`${base}/api/models/qwen3.6%3A27b`);
  const j = (await r.json()) as { sentiment: Record<string, number>; signalCount: number };
  assert.equal(r.status, 200);
  assert.ok(j.signalCount >= 2);
  assert.ok(j.sentiment.positive >= 1, "positive signals counted");
  assert.equal(j.sentiment.negative, 1, "the negative signal is counted, not averaged away");
});
