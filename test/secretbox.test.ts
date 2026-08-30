/**
 * Secret vault suite — the security properties, held to spec.
 *
 * These are the tests that matter most in the repo: they guard someone
 * else's payment credentials. Every assertion here is a promise we made
 * to a creator who typed their key into our form.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";

import { hint, isConfigured, open, safeEqual, seal } from "../src/server/secretbox";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.LINKS_SECRET_KEY;
  if (key === undefined) delete process.env.LINKS_SECRET_KEY;
  else process.env.LINKS_SECRET_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.LINKS_SECRET_KEY;
    else process.env.LINKS_SECRET_KEY = prev;
  }
}

test("vault: seals and opens a round trip for the owner it was sealed to", () => {
  withKey(KEY_A, () => {
    const secret = "rzp_live_secret_ZfQ2m8xK1p";
    const sealed = seal(secret, "idn_alice");
    assert.notEqual(sealed, secret, "the stored form is not the plaintext");
    assert.equal(sealed.includes(secret), false, "plaintext never appears inside the blob");
    assert.ok(sealed.startsWith("v1."), "blob is self-describing for future rotation");
    assert.equal(open(sealed, "idn_alice"), secret, "owner can open it");
  });
});

test("vault: a blob is pinned to its owner — moving a row does not move the secret", () => {
  withKey(KEY_A, () => {
    const sealed = seal("rzp_live_secret_ZfQ2m8xK1p", "idn_alice");
    // The attack this prevents: anyone who can WRITE the database (but not
    // read the master key) copies Alice's sealed credential into Bob's row
    // and reads it back through the normal decrypt path.
    assert.equal(open(sealed, "idn_bob"), null, "a lifted blob will not open for another owner");
    assert.equal(open(sealed, ""), null, "no owner, no open");
  });
});

test("vault: never reuses an IV — identical plaintext seals differently every time", () => {
  withKey(KEY_A, () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(seal("same-secret-every-time", "idn_alice"));
    assert.equal(seen.size, 50, "50 seals produced 50 distinct blobs (fresh IV per call)");
    // GCM catastrophically fails on IV reuse, so this is not a style point.
    const ivs = new Set([...seen].map((s) => s.split(".")[1]));
    assert.equal(ivs.size, 50, "every IV is unique");
  });
});

test("vault: tampering is detected, not silently tolerated", () => {
  withKey(KEY_A, () => {
    const sealed = seal("rzp_live_secret_ZfQ2m8xK1p", "idn_alice");
    const [v, iv, tag, body] = sealed.split(".");

    const flip = (b64: string): string => {
      const buf = Buffer.from(b64, "base64url");
      buf[0] ^= 0x01;
      return buf.toString("base64url");
    };

    assert.equal(open([v, iv, tag, flip(body)].join("."), "idn_alice"), null, "flipped ciphertext rejected");
    assert.equal(open([v, flip(iv), tag, body].join("."), "idn_alice"), null, "flipped IV rejected");
    assert.equal(open([v, iv, flip(tag), body].join("."), "idn_alice"), null, "flipped tag rejected");
    assert.equal(open(`v2.${iv}.${tag}.${body}`, "idn_alice"), null, "unknown version rejected");
  });
});

test("vault: another deployment's key cannot open this deployment's secrets", () => {
  const sealed = withKey(KEY_A, () => seal("rzp_live_secret_ZfQ2m8xK1p", "idn_alice"));
  withKey(KEY_B, () => {
    assert.equal(open(sealed, "idn_alice"), null, "wrong master key opens nothing");
  });
});

test("vault: refuses to operate without a master key rather than degrading", () => {
  withKey(undefined, () => {
    assert.equal(isConfigured(), false, "unconfigured deployments report it");
    // The failure mode that must NEVER exist: storing the plaintext because
    // encryption wasn't available. Better to refuse the feature outright.
    assert.throws(() => seal("secret", "idn_alice"), /LINKS_SECRET_KEY/, "seal refuses, loudly");
    assert.equal(open("v1.a.b.c", "idn_alice"), null, "open refuses, quietly");
  });
  withKey("too-short", () => {
    assert.equal(isConfigured(), false, "a malformed key is treated as no key");
    assert.throws(() => seal("secret", "idn_alice"), /LINKS_SECRET_KEY/);
  });
  withKey(KEY_A, () => assert.equal(isConfigured(), true, "a valid 32-byte key configures the vault"));
  withKey(randomBytes(32).toString("hex"), () =>
    assert.equal(isConfigured(), true, "hex master keys are accepted too"),
  );
});

test("vault: garbage in returns null, never a throw and never a partial value", () => {
  withKey(KEY_A, () => {
    for (const junk of [null, undefined, 42, {}, [], "", "not-a-blob", "v1.", "v1.a.b", "v1.a.b.c.d"]) {
      assert.equal(open(junk, "idn_alice"), null, `rejected: ${JSON.stringify(junk)}`);
    }
  });
});

test("vault: the hint is the only shape of a secret allowed near a client", () => {
  assert.equal(hint("rzp_live_secret_ZfQ2m8xK1p"), "•••• xK1p", "last four characters only");
  assert.equal(hint("abcd"), "••••", "short values reveal nothing at all");
  assert.equal(hint(""), "••••");
  const h = hint("rzp_live_secret_ZfQ2m8xK1p");
  assert.equal(h.includes("rzp_live"), false, "the identifiable prefix never leaks");
  assert.ok(h.length < 12, "the hint cannot be long enough to be useful to an attacker");
});

test("vault: signature comparison is constant-time and length-safe", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  assert.equal(safeEqual("abc", "abc123"), false, "different lengths are not equal");
  assert.equal(safeEqual("", ""), false, "empty never validates — an unset signature is not a match");
  assert.equal(safeEqual("x", ""), false);
});
