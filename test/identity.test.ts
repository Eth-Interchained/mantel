/**
 * Derived-identity suite.
 *
 * The property that matters: the same nickname + salt must produce the same
 * identity forever, on any machine, and different inputs must never collide.
 * If that breaks, every visitor silently becomes a stranger.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NICKNAME_MAX,
  SHORT_LEN,
  deriveIdentity,
  formatHandle,
  hueFromHash,
  normalizeNickname,
  parseHandle,
  validIdentityHash,
  validNickname,
} from "../src/server/identity";

test("derivation is deterministic", () => {
  const a = deriveIdentity("mark", "correct horse battery staple");
  const b = deriveIdentity("mark", "correct horse battery staple");
  assert.equal(a.hash, b.hash);
  assert.equal(a.handle, b.handle);
  assert.equal(a.hue, b.hue);
});

test("nickname case and surrounding space do not change the identity", () => {
  // Otherwise someone who capitalizes on their phone becomes a different person.
  const a = deriveIdentity("mark", "s3cret");
  const b = deriveIdentity("  MARK  ", "s3cret");
  assert.equal(a.hash, b.hash);
});

test("a different salt is a different identity", () => {
  const a = deriveIdentity("mark", "salt-one");
  const b = deriveIdentity("mark", "salt-two");
  assert.notEqual(a.hash, b.hash);
});

test("a different nickname is a different identity", () => {
  const a = deriveIdentity("mark", "same-salt");
  const b = deriveIdentity("marisa", "same-salt");
  assert.notEqual(a.hash, b.hash);
});

test("field boundaries cannot be shifted to force a collision", () => {
  // Without a separator, "ab"+"c" and "a"+"bc" would hash identically and two
  // unrelated people would share one identity.
  // Both nicknames are valid and both salts non-empty; only the boundary moves.
  const a = deriveIdentity("abc", "d");
  const b = deriveIdentity("ab", "cd");
  assert.notEqual(a.hash, b.hash);
});

test("an empty salt is refused rather than silently accepted", () => {
  assert.throws(() => deriveIdentity("mark", ""), /salt must be a non-empty string/);
});

test("invalid nicknames are refused with a usable message", () => {
  assert.throws(() => deriveIdentity("m", "salt"), /invalid nickname/);
  assert.throws(() => deriveIdentity("has space", "salt"), /invalid nickname/);
  assert.throws(() => deriveIdentity("_leading", "salt"), /invalid nickname/);
  assert.throws(() => deriveIdentity("x".repeat(NICKNAME_MAX + 1), "salt"), /invalid nickname/);
});

test("valid nicknames cover the documented character set", () => {
  assert.ok(validNickname("mark"));
  assert.ok(validNickname("mark_evans"));
  assert.ok(validNickname("m4rk-2"));
  assert.ok(validNickname("MARK"), "uppercase is normalized, not rejected");
  assert.ok(!validNickname("m"));
  assert.ok(!validNickname("-nope"));
  assert.ok(!validNickname("emoji🔥"));
});

test("the handle carries a readable short hash", () => {
  const id = deriveIdentity("mark", "salt");
  const parsed = parseHandle(id.handle);
  assert.ok(parsed, "the handle we produce must be one we can parse back");
  assert.equal(parsed.nickname, "mark");
  assert.equal(parsed.short.length, SHORT_LEN);
  assert.ok(id.hash.startsWith(parsed.short));
});

test("parseHandle rejects malformed handles instead of guessing", () => {
  assert.equal(parseHandle("mark"), null);
  assert.equal(parseHandle("mark#xyz"), null, "short hash must be hex");
  assert.equal(parseHandle("mark#abc"), null, "short hash must be the right length");
  assert.equal(parseHandle("#abc123"), null);
});

test("the hash format check accepts real digests and rejects near-misses", () => {
  const id = deriveIdentity("mark", "salt");
  assert.ok(validIdentityHash(id.hash));
  assert.ok(!validIdentityHash(id.hash.slice(0, 63)), "too short");
  assert.ok(!validIdentityHash(id.hash.toUpperCase()), "hex is lowercase");
  assert.ok(!validIdentityHash(`${id.hash}0`), "too long");
});

test("hue is stable and in range", () => {
  const id = deriveIdentity("mark", "salt");
  assert.equal(hueFromHash(id.hash), id.hue);
  assert.ok(id.hue >= 0 && id.hue < 360);
});

test("normalizeNickname and formatHandle agree on canonical form", () => {
  assert.equal(normalizeNickname("  MaRk "), "mark");
  assert.equal(formatHandle("MaRk", "abcdef0123"), "mark#abcdef");
});
