/**
 * Embedded engine adapter suite — the seam that replaced nedb-engine-client.
 *
 * Runs against the REAL nedb-engine native addon in a scratch data dir. No
 * daemon, no mocks. Covers the surface the whole server depends on, plus the
 * two properties that only matter because we went embedded: provenance
 * chaining through the caused_by lane, and the dropDatabase guard.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync } from "node:fs";

const DIR = `./.tmp/mantel_embedded_${Date.now().toString(36)}_test`;
process.env.NEDB_DATA_DIR = DIR;

const { db, causalParent } = await import("../src/server/db");

before(async () => {
  assert.ok(await db.ping(), "embedded engine must open");
});

after(async () => {
  await db.dropDatabase();
});

test("health reports the embedded engine, not a daemon", async () => {
  const h = await db.health();
  assert.equal(h.ok, true);
  assert.equal(h.engine, "embedded-v2-dag");
  // head() is "" on a store with no writes yet — an honest empty head, not a
  // failure. Once anything is written it must be a hash (asserted below).
  assert.match(h.head, /^([0-9a-f]{8,})?$/, "head is empty or a hash");
  assert.equal(typeof h.seq, "number");
  assert.notEqual(h.version, "unknown", "engine version resolves from package.json");
});

test("put returns a PutResult receipt matching the client contract", async () => {
  // nedb-engine-client returned {ok, doc, seq, head} and routes echo
  // put.seq / put.head to API clients. The node lives under .doc — getting
  // this wrong makes every write receipt read "undefined:undefined".
  const put = await db.put("models", "deepseek-r1:32b", {
    name: "DeepSeek R1 32B",
    params: "32B",
  });
  assert.equal(put.ok, true);
  assert.equal(typeof put.seq, "number");
  assert.match(put.head, /^[0-9a-f]{32,}$/, "receipt carries the Merkle head");
  assert.equal(put.doc._id, "deepseek-r1:32b");
  assert.equal(put.doc._coll, "models");
  assert.equal(typeof put.doc._hash, "string");
  assert.equal((put.doc as { name: string }).name, "DeepSeek R1 32B");
});

test("get round-trips; missing ids are null, not a throw", async () => {
  await db.put("models", "qwen3.6:27b", { name: "Qwen3.6 27B" });
  const found = await db.get("models", "qwen3.6:27b");
  assert.equal((found as { name: string } | null)?.name, "Qwen3.6 27B");
  assert.equal(await db.get("models", "does-not-exist"), null);
});

test("query runs NQL and parses every row", async () => {
  await db.put("signals", "s1", { model_ref: "a", sentiment: "pos" });
  await db.put("signals", "s2", { model_ref: "a", sentiment: "neg" });
  const rows = (await db.query(`FROM signals WHERE sentiment = "pos"`)) as {
    _id: string;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, "s1");
});

test("delete removes the document", async () => {
  await db.put("scratch", "gone", { x: 1 });
  assert.ok(await db.get("scratch", "gone"));
  assert.equal(await db.delete("scratch", "gone"), true);
  assert.equal(await db.get("scratch", "gone"), null);
});

test("causedBy chains provenance and TRACE walks it back", async () => {
  const src = await db.put("source_documents", "src1", { url: "https://example.test/post" });
  const sig = await db.put(
    "signals",
    "traced",
    { model_ref: "deepseek-r1:32b", claim: "fits in 24GB at Q4" },
    { causedBy: causalParent(src.doc), evidence: "captured from source_documents/src1" },
  );
  assert.deepEqual(sig.doc._caused_by, [src.doc._hash], "caused_by lane carries the parent hash");
  assert.equal(
    (sig.doc as { evidence: string }).evidence,
    "captured from source_documents/src1",
  );

  const traced = (await db.query(
    `FROM signals WHERE _id = "traced" TRACE caused_by`,
  )) as { _id: string }[];
  const ids = traced.map((r) => r._id);
  assert.ok(ids.includes("traced"), "TRACE includes the origin row");
  assert.ok(ids.includes("src1"), "TRACE reaches the causal parent");
});

test("causalParent returns [] for a new document", () => {
  assert.deepEqual(causalParent(null), []);
  assert.deepEqual(causalParent({ no: "hash" }), []);
  assert.deepEqual(causalParent({ _hash: "abc" }), ["abc"]);
});

test("verify returns a report, not a bare boolean", async () => {
  // The daemon client returned {ok, head, seq} and the verify beacon in
  // raffles.ts reads .head/.seq off it. Embedded must match that shape or the
  // beacon silently renders "undefined:undefined".
  const report = await db.verify();
  assert.equal(report.ok, true);
  assert.equal(typeof report.head, "string");
  assert.equal(typeof report.seq, "number");
  assert.equal(report.tamper_evident, true);
  assert.deepEqual(report.tampered, []);
  // -1 = "this transport does not report a count" — never a fabricated number.
  assert.equal(report.objects_checked, -1);
});

test("head becomes a real hash once the store has writes", async () => {
  await db.put("headtest", "h1", { n: 1 });
  const h = await db.health();
  assert.match(h.head, /^[0-9a-f]{8,}$/, "head is a hash after a write");
  assert.ok(h.seq >= 0);
});

test("_caused_by is normalized onto reads, not just writes", async () => {
  const parent = await db.put("source_documents", "srcRead", { url: "https://x.test" });
  await db.put(
    "signals",
    "readback",
    { claim: "quantized fine" },
    { causedBy: causalParent(parent.doc) },
  );
  const got = await db.get("signals", "readback");
  assert.deepEqual(got?._caused_by, [parent.doc._hash], "get() surfaces _caused_by");
  const rows = (await db.query(`FROM signals WHERE _id = "readback"`)) as {
    _caused_by?: string[];
  }[];
  assert.deepEqual(rows[0]?._caused_by, [parent.doc._hash], "query() surfaces _caused_by");
});

test("tip returns the latest write, and the latest in one collection", async () => {
  await db.put("tiptest", "first", { n: 1 });
  await db.put("tiptest", "second", { n: 2 });
  const collTip = await db.tip("tiptest");
  assert.equal(collTip?._id, "second");
  const anyTip = await db.tip();
  assert.ok(anyTip, "a non-empty store has a tip");
});

test("dropDatabase refuses a data dir that does not look like scratch", async () => {
  const { config } = await import("../src/server/config");
  const real = config.nedbDataDir;
  try {
    (config as { nedbDataDir: string }).nedbDataDir = "./mantel-data";
    await assert.rejects(() => db.dropDatabase(), /refusing to drop data dir/);
    assert.ok(existsSync(real), "the real scratch dir is untouched by the refusal");
  } finally {
    (config as { nedbDataDir: string }).nedbDataDir = real;
  }
});
