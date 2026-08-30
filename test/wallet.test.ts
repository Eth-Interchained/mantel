/**
 * Wallet suite — the Links account IS an Interchained wallet, proven.
 *
 * Pure unit tests, no engine needed. The derivation is pinned to the
 * PUBLISHED BIP84 test vector so account math is checked against the
 * standard, not against itself — the Elara compatibility contract.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addressFromPublicKey,
  buildAuthMessage,
  deriveAccount,
  DERIVATION_PATH,
  generatePhrase,
  INTERCHAINED,
  isItcAddress,
  magicHash,
  normalizePhrase,
  shortAddress,
  signMessage,
  validatePhrase,
  verifyMessage,
} from "../src/lib/wallet";

// The canonical BIP84 test mnemonic (public, spec-published — never use for funds).
const VECTOR_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("network parameters match itcd chainparams", () => {
  assert.equal(INTERCHAINED.bech32, "itc");
  assert.equal(INTERCHAINED.messagePrefix, "Interchained Signed Message:\n");
  assert.equal(INTERCHAINED.pubKeyHash, 0x00);
  assert.equal(INTERCHAINED.scriptHash, 0x05);
  assert.equal(INTERCHAINED.wif, 0x80);
  assert.equal(DERIVATION_PATH, "m/84'/0'/0'/0/0", "Elara's native segwit path");
});

test("derivation reproduces the published BIP84 vector (ITC-encoded)", async () => {
  const account = await deriveAccount(VECTOR_PHRASE);
  // Same key material as bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu — proven
  // against the published vector; here encoded with ITC's bech32 HRP.
  assert.equal(account.address, "itc1qcr8te4kr609gcawutmrza0j4xv80jy8zw9vpf3");
  assert.equal(account.publicKey.length, 66, "compressed pubkey hex");
  assert.equal(account.path, DERIVATION_PATH);
});

test("phrase generation and validation", () => {
  const phrase = generatePhrase();
  assert.equal(phrase.split(" ").length, 12);
  assert.equal(validatePhrase(phrase), true);
  assert.equal(validatePhrase("clearly not a mnemonic"), false);
  assert.equal(validatePhrase(phrase.toUpperCase()), true, "case-forgiving");
  assert.equal(normalizePhrase("  Abandon   ABANDON\nabout  "), "abandon abandon about");
});

test("two phrases never collide", async () => {
  const a = await deriveAccount(generatePhrase());
  const b = await deriveAccount(generatePhrase());
  assert.notEqual(a.address, b.address);
});

test("address validation is structural", async () => {
  const { address } = await deriveAccount(VECTOR_PHRASE);
  assert.equal(isItcAddress(address), true);
  assert.equal(isItcAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"), false, "wrong HRP");
  assert.equal(isItcAddress("itc1qqqqq"), false, "malformed");
  assert.equal(isItcAddress(42), false);
  assert.equal(shortAddress(address).includes("…"), true);
});

test("sign/verify round trip with ITC message magic", async () => {
  const phrase = generatePhrase();
  const { address } = await deriveAccount(phrase);
  const message = buildAuthMessage("chal_test", "nonce123");

  const sig = await signMessage(phrase, message);
  assert.equal(verifyMessage(address, message, sig), true, "valid signature verifies");

  // Tampered message fails.
  assert.equal(verifyMessage(address, message + "x", sig), false);
  // Wrong address fails.
  const other = await deriveAccount(generatePhrase());
  assert.equal(verifyMessage(other.address, message, sig), false);
  // Corrupted signature fails without throwing.
  assert.equal(verifyMessage(address, message, sig.slice(0, -4) + "AAAA"), false);
  assert.equal(verifyMessage(address, message, "garbage"), false);
});

test("magicHash is deterministic and domain-separated", () => {
  const a = magicHash("hello");
  const b = magicHash("hello");
  const c = magicHash("hello!");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 32);
});

test("auth message is stable and human-readable", () => {
  const m = buildAuthMessage("chal_abc", "nonce_xyz");
  assert.equal(m, "NEDB Links authentication\nchallenge: chal_abc\nnonce: nonce_xyz");
});

test("pubkey → address is deterministic", async () => {
  const phrase = generatePhrase();
  const acct = await deriveAccount(phrase);
  const pub = Uint8Array.from(
    acct.publicKey.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  assert.equal(addressFromPublicKey(pub), acct.address);
});
