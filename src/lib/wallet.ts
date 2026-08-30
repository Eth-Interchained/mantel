/**
 * The Links account: an Interchained wallet. No different.
 *
 * Twelve BIP39 words → BIP84 derivation (m/84'/0'/0'/0/0 — Elara's own
 * native-segwit path) → secp256k1 keypair → P2WPKH address with ITC's
 * bech32 prefix. The same phrase that owns a Links identity controls an
 * ITC address in Elara, byte for byte. Verified against the published
 * BIP84 test vector and itcd's chainparams.
 *
 * No passwords. No emails. No recovery — it's a seed phrase; write it
 * down. The phrase NEVER leaves the client and is never persisted; the
 * server sees only addresses, signatures, and hashed session tokens.
 *
 * Auth is Bitcoin-style signed messages: double-sha256 over a
 * varint-framed payload with ITC's message magic
 * ("Interchained Signed Message:\n", from itcd util/message.cpp), signed
 * with a recoverable signature packed BIP137-style. Verification
 * recovers the public key and compares the derived itc1 address.
 *
 * This module is isomorphic — the browser derives and signs; the server
 * verifies. Same file, same math.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { BIP32Factory } from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import { address as itcAddress, payments, type Network } from "interchainedjs-lib";

/** ITC network parameters — verified against itcd src/chainparams.cpp. */
export const INTERCHAINED: Network = {
  messagePrefix: "Interchained Signed Message:\n",
  bech32: "itc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};

/** Elara's native-segwit account path — receive address 0. */
export const DERIVATION_PATH = "m/84'/0'/0'/0/0";

const bip32 = BIP32Factory(ecc);
const enc = new TextEncoder();

// ── Phrase ───────────────────────────────────────────────────────────────────

/** Twelve fresh words (128-bit entropy), standard English wordlist. */
export function generatePhrase(): string {
  return bip39.generateMnemonic(wordlist, 128);
}

export function validatePhrase(phrase: string): boolean {
  return bip39.validateMnemonic(normalizePhrase(phrase), wordlist);
}

/** Trim, collapse whitespace, lowercase — forgiving paste handling. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

// ── Keys & address ───────────────────────────────────────────────────────────

export interface LinksAccount {
  /** itc1q… — the account address. Public identity of the owner. */
  address: string;
  /** Compressed secp256k1 public key, hex. */
  publicKey: string;
  path: typeof DERIVATION_PATH;
}

async function deriveKey(phrase: string): Promise<{ priv: Uint8Array; pub: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(normalizePhrase(phrase));
  const child = bip32.fromSeed(seed).derivePath(DERIVATION_PATH);
  if (!child.privateKey) throw new Error("derivation yielded no private key");
  return { priv: child.privateKey, pub: child.publicKey };
}

export function addressFromPublicKey(pubkey: Uint8Array): string {
  const { address } = payments.p2wpkh({ pubkey, network: INTERCHAINED });
  if (!address) throw new Error("address derivation failed");
  return address;
}

/** Derive the account (address + pubkey) from a phrase. Client-side. */
export async function deriveAccount(phrase: string): Promise<LinksAccount> {
  const { pub } = await deriveKey(phrase);
  return {
    address: addressFromPublicKey(pub),
    publicKey: bytesToHex(pub),
    path: DERIVATION_PATH,
  };
}

/** Structural validation of an itc1 P2WPKH address. */
export function isItcAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const d = itcAddress.fromBech32(value);
    return d.prefix === "itc" && d.version === 0 && d.data.length === 20;
  } catch {
    return false;
  }
}

/** itc1qxy2k…x0wlh — display form for UI chrome. */
export function shortAddress(addr: string): string {
  return addr.length <= 16 ? addr : `${addr.slice(0, 10)}…${addr.slice(-5)}`;
}

// ── Signed messages (ITC magic, BIP137 recoverable) ─────────────────────────

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.from([n]);
  if (n <= 0xffff) return Uint8Array.from([0xfd, n & 0xff, n >> 8]);
  throw new Error("message too long");
}

/** Double-sha256 over varint-framed magic + message — Bitcoin's magicHash. */
export function magicHash(message: string): Uint8Array {
  const magic = enc.encode(INTERCHAINED.messagePrefix);
  const msg = enc.encode(message);
  const framed = new Uint8Array(
    varint(magic.length).length + magic.length + varint(msg.length).length + msg.length,
  );
  let o = 0;
  for (const part of [varint(magic.length), magic, varint(msg.length), msg]) {
    framed.set(part, o);
    o += part.length;
  }
  return sha256(sha256(framed));
}

/** Sign a message with the phrase's key. Returns base64 (65 bytes,
 *  BIP137 P2WPKH header 39 + recid). */
export async function signMessage(phrase: string, message: string): Promise<string> {
  const { priv } = await deriveKey(phrase);
  const h = magicHash(message);
  const recovered = secp256k1.sign(h, priv, { format: "recovered", prehash: false });
  const packed = new Uint8Array(65);
  packed[0] = 39 + recovered[0]; // BIP137 native-segwit header range
  packed.set(recovered.slice(1), 1);
  return bytesToBase64(packed);
}

/** Verify a signed message against an itc1 address. Accepts BIP137
 *  headers 27–42 (legacy, compressed, segwit ranges — Electrum too). */
export function verifyMessage(addr: string, message: string, signatureB64: string): boolean {
  try {
    if (!isItcAddress(addr)) return false;
    const packed = base64ToBytes(signatureB64);
    if (packed.length !== 65) return false;
    const header = packed[0];
    if (header < 27 || header > 42) return false;
    const recid = (header - 27) & 3;
    const recovered = new Uint8Array(65);
    recovered[0] = recid;
    recovered.set(packed.slice(1), 1);
    const h = magicHash(message);
    const pub = secp256k1.recoverPublicKey(recovered, h, { prehash: false });
    return addressFromPublicKey(pub) === addr;
  } catch {
    return false;
  }
}

/** The exact text a client signs to authenticate. Human-readable on
 *  purpose — wallets should display what they sign. */
export function buildAuthMessage(challengeId: string, nonce: string): string {
  return `NEDB Links authentication\nchallenge: ${challengeId}\nnonce: ${nonce}`;
}

// ── Encoding helpers (isomorphic — no Buffer) ────────────────────────────────

export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(b: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).Buffer.from(b).toString("base64");
}

export function base64ToBytes(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(s, "base64"));
}

/** 32 random bytes as hex — nonces and session tokens. */
export function randomHex32(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** sha256 of a UTF-8 string, hex — session tokens are stored hashed. */
export function sha256Hex(value: string): string {
  return bytesToHex(sha256(enc.encode(value)));
}
