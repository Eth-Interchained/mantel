/**
 * App-side aggregation — the fallback that makes analytics correct on
 * every engine build, including rust nedb-v2 (which parses GROUP BY
 * but does not execute it, returning raw filtered events).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateBy } from "../src/server/analytics";

test("aggregateBy counts raw events like the engine would", () => {
  const rows = [
    { identityId: "idn_a", kind: "profile_view", source: "direct" },
    { identityId: "idn_a", kind: "profile_view", source: "direct" },
    { identityId: "idn_a", kind: "profile_view", source: "qr" },
    { identityId: "idn_a", kind: "vcard_download", source: "direct" },
    { identityId: "idn_a", kind: "link_click", blockId: "b1" },
    { identityId: "idn_a", kind: "link_click", blockId: "b1" },
    { identityId: "idn_a", kind: "link_click", blockId: "b2" },
  ];

  assert.deepEqual(aggregateBy(rows, "kind"), [
    { key: "profile_view", count: 3 },
    { key: "link_click", count: 3 },
    { key: "vcard_download", count: 1 },
  ].sort((a, b) => b.count - a.count));

  const bySource = aggregateBy(rows.filter((r) => r.kind === "profile_view"), "source");
  assert.deepEqual(bySource, [
    { key: "direct", count: 2 },
    { key: "qr", count: 1 },
  ]);

  const byBlock = aggregateBy(rows.filter((r) => r.kind === "link_click"), "blockId");
  assert.deepEqual(byBlock, [
    { key: "b1", count: 2 },
    { key: "b2", count: 1 },
  ]);
});

test("aggregateBy is defensive: missing fields bucket as unknown, empty in empty out", () => {
  assert.deepEqual(aggregateBy([], "kind"), []);
  assert.deepEqual(aggregateBy([{ a: 1 }, { a: 2 }], "kind"), [{ key: "unknown", count: 2 }]);
  // Sorted descending, always.
  const sorted = aggregateBy(
    [{ s: "x" }, { s: "y" }, { s: "y" }, { s: "y" }, { s: "x" }],
    "s",
  );
  assert.deepEqual(sorted.map((r) => r.key), ["y", "x"]);
});
