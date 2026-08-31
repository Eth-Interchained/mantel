/**
 * Client/server identity parity.
 *
 * The salt is derived in the BROWSER (@noble/hashes) and validated/displayed on
 * the SERVER (node:crypto). Two implementations of one derivation is a drift
 * waiting to happen, and the failure mode is silent and catastrophic: the same
 * person gets two different identities depending on which side computed it.
 *
 * This test is the only thing standing between us and that bug. It runs both
 * implementations on the same inputs and demands byte-identical output.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveIdentity as serverDerive } from "../src/server/identity";
import { deriveIdentity as clientDerive } from "../src/lib/identity";

const VECTORS: [string, string][] = [
  ["mark", "correct horse battery staple"],
  ["interchained", "a"],
  ["m4rk-2", "🔥 unicode salt 🔥"],
  ["vex", "x".repeat(512)],
  ["a1", "\x00\x1f\\\" edge bytes"],
];

test("client and server derive byte-identical identities", () => {
  for (const [nick, salt] of VECTORS) {
    const s = serverDerive(nick, salt);
    const c = clientDerive(nick, salt);
    assert.equal(c.hash, s.hash, `hash drift for nickname "${nick}"`);
    assert.equal(c.handle, s.handle, `handle drift for nickname "${nick}"`);
    assert.equal(c.hue, s.hue, `hue drift for nickname "${nick}"`);
  }
});

test("both sides normalize nicknames the same way", () => {
  const s = serverDerive("  MARK  ", "salt");
  const c = clientDerive("MaRk", "salt");
  assert.equal(c.hash, s.hash);
});

test("both sides reject the same invalid nicknames", () => {
  for (const bad of ["m", "has space", "_lead", "x".repeat(25), "emoji🔥"]) {
    assert.throws(() => serverDerive(bad, "salt"), `server accepted "${bad}"`);
    assert.throws(() => clientDerive(bad, "salt"), `client accepted "${bad}"`);
  }
});

test("both sides reject an empty salt", () => {
  assert.throws(() => serverDerive("mark", ""));
  assert.throws(() => clientDerive("mark", ""));
});

test("the derivation is pinned to a known vector", () => {
  // A regression guard with teeth: if either implementation changes its
  // primitive, separator, or truncation, this fails even if the two sides
  // still agree with each other.
  const { hash } = serverDerive("mark", "correct horse battery staple");
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // Value captured from the current implementation and asserted from here on.
  assert.equal(hash, KNOWN_VECTOR, "derivation changed — every existing identity would break");
});

/** blake2b512("mark" \x1f "correct horse battery staple"), first 64 hex chars. */
const KNOWN_VECTOR = "5a7ea53f20ccc566c8f70f8a8be096d476a6df49b421f9602f54ee966f6ec068";
