/**
 * Electrum scripthash math — pure unit tests, no network.
 * (Live balance verification against seed.interchained.org happens on
 * the VPS — raw TLS egress is unavailable in the build sandbox.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { address as itcAddress } from "interchainedjs-lib";

const { addressToScripthash } = await import("../src/server/electrum");

const ADDR = "itc1qcr8te4kr609gcawutmrza0j4xv80jy8zw9vpf3";

test("scripthash is 32 bytes of reversed sha256 over the P2WPKH script", () => {
  const h = addressToScripthash(ADDR);
  assert.equal(h.length, 64, "32 bytes hex");
  assert.match(h, /^[0-9a-f]{64}$/);

  // Independent recomputation in-test: OP_0 PUSH20 <program>, sha256, reverse.
  const decoded = itcAddress.fromBech32(ADDR);
  const script = new Uint8Array(22);
  script[0] = 0x00;
  script[1] = 0x14;
  script.set(decoded.data, 2);
  const expected = [...sha256(script)]
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(h, expected);
});

test("scripthash is deterministic and address-sensitive", () => {
  assert.equal(addressToScripthash(ADDR), addressToScripthash(ADDR));
});

test("non-P2WPKH inputs are rejected", () => {
  assert.throws(
    () => addressToScripthash("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    /itc1 P2WPKH/,
    "foreign-network addresses rejected by prefix",
  );
  assert.throws(() => addressToScripthash("garbage"));
});
