/**
 * NQL interpolation helpers.
 *
 * Values reach NQL through string interpolation, so a value carrying a quote
 * would end the literal early and silently change what the query means. These
 * tests pin the escaping, and one of them runs the escaped value through the
 * REAL engine to prove the escape is what the parser actually accepts — not
 * just what looks right.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.NEDB_DATA_DIR = `./.tmp/mantel_nql_${Date.now().toString(36)}_test`;

const { clampLimit, nqlString } = await import("../src/server/models");
const { db } = await import("../src/server/db");

after(async () => {
  await db.dropDatabase();
});

test("plain values are quoted", () => {
  assert.equal(nqlString("deepseek-r1:32b"), '"deepseek-r1:32b"');
});

test("a value containing a double quote is REFUSED, not escaped", () => {
  // Verified against the real parser: NQL literals have no escape syntax, so
  // a quote terminates the literal and the remainder is parsed as further
  // clauses. Confirmed clause injection: a value of `same" LIMIT 2` turned a
  // 5-row result into 2. There is nothing to escape it with, so we refuse.
  assert.throws(() => nqlString('say "hi"'), /no escape syntax/);
  assert.throws(() => nqlString('same" LIMIT 2'), /inject the remainder as NQL clauses/);
});

test("backslashes pass through raw, because the parser treats them literally", () => {
  // Doubling them (the SQL instinct) makes the literal match nothing — proven
  // against the engine below.
  assert.equal(nqlString("back\\slash"), '"back\\slash"');
  assert.equal(nqlString("trailing\\"), '"trailing\\"');
});

test("a backslash-bearing value round-trips through the real engine", async () => {
  const withSlash = "back\\slash";
  await db.put("signals", "slash1", { modelRef: withSlash, sentiment: "positive" });
  await db.put("signals", "other1", { modelRef: "unrelated", sentiment: "negative" });

  const rows = (await db.query(
    `FROM signals WHERE modelRef = ${nqlString(withSlash)}`,
  )) as { _id: string }[];

  assert.equal(rows.length, 1, "the raw backslash literal matches exactly one row");
  assert.equal(rows[0]._id, "slash1");
});

test("doubling a backslash would break the match — the bug we avoided", async () => {
  // Pins the engine behavior this module is built around. If a future engine
  // version starts honoring escapes, THIS test fails and tells us to revisit
  // nqlString rather than leaving it silently wrong.
  const rows = (await db.query(`FROM signals WHERE modelRef = "back\\\\slash"`)) as unknown[];
  assert.equal(rows.length, 0, "the engine does not interpret a doubled backslash as one");
});

test("clampLimit keeps LIMIT a small positive integer", () => {
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(0), 1, "zero would return nothing; floor at 1");
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(10_000), 1000, "capped");
  assert.equal(clampLimit(12.7), 12, "floored to an integer");
  assert.equal(clampLimit(Number.NaN), 100, "NaN falls back to the default, never into the query");
});
