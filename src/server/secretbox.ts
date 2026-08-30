/**
 * Sealed secrets at rest — AES-256-GCM, node crypto, zero new deps.
 *
 * WHY THIS EXISTS
 * Tier-2 UPI lets a creator bring their OWN payment-provider keys so the
 * money moves creator→bank with Interchained never acting as merchant of
 * record, never taking custody, never taking a cut (Mark's call,
 * 2026-08-21). Holding someone else's payment secret is the price of that
 * design, so it gets held properly or not at all.
 *
 * THE CONTRACT
 *   - Plaintext secrets exist in memory only, for the length of one
 *     request. They are never logged, never echoed to a client, never
 *     written to the engine unsealed.
 *   - Every seal uses a fresh 12-byte IV. Never reuse an IV with GCM:
 *     two messages under one key+IV leaks the keystream and forges the
 *     tag. randomBytes per call, no counters, no caching.
 *   - AAD binds the ciphertext to WHO it belongs to. A sealed blob lifted
 *     out of one creator's row and pasted into another's fails to open,
 *     so a database write primitive can't be turned into key theft.
 *   - open() returns null on ANY failure — wrong key, tampered blob,
 *     wrong owner, malformed input. Callers treat null as "no credential",
 *     never as "empty credential".
 *
 * THE MASTER KEY
 * LINKS_SECRET_KEY, 32 bytes as base64 or hex. Absent = the vault refuses
 * to seal at all (isConfigured() false) rather than degrading to plaintext
 * storage. A deployment that hasn't set it simply cannot offer Tier 2 —
 * that is the correct failure. Rotating it strands existing blobs by
 * design; there is no fallback-to-old-key path, because a silent decrypt
 * fallback is how you end up never actually rotating.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard; 96-bit IVs are the fast, safe path
const TAG_BYTES = 16;
const VERSION = "v1";

/** Parse the master key once. Returns null when unset/malformed. */
function masterKey(): Buffer | null {
  const raw = (process.env.LINKS_SECRET_KEY ?? "").trim();
  if (!raw) return null;
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) buf = b;
    } catch {
      buf = null;
    }
  }
  return buf && buf.length === 32 ? buf : null;
}

/** Can this deployment hold secrets at all? Gate Tier 2 on this. */
export function isConfigured(): boolean {
  return masterKey() !== null;
}

/**
 * Seal a plaintext secret for one owner.
 *
 * `owner` is authenticated context (the principal/identity the credential
 * belongs to) — NOT user input. It becomes AAD, so the sealed blob is
 * cryptographically pinned to that owner.
 *
 * Returns a self-describing string: v1.<iv>.<tag>.<ciphertext>, all
 * base64url. Throws only when the deployment has no master key, which is
 * a configuration error the caller must check for with isConfigured().
 */
export function seal(plaintext: string, owner: string): string {
  const key = masterKey();
  if (!key) throw new Error("LINKS_SECRET_KEY is not configured — refusing to store a secret");
  if (!owner) throw new Error("seal() requires an owner to bind the ciphertext to");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${owner}`, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * Open a sealed secret. Returns null on any failure — including a blob
 * that belongs to a different owner.
 *
 * Never throws: a caller deciding what to do about a missing credential
 * shouldn't also have to catch. Never logs the failure reason either;
 * "which part of the crypto failed" is an oracle we don't hand out.
 */
export function open(sealed: unknown, owner: string): string | null {
  const key = masterKey();
  if (!key || !owner || typeof sealed !== "string") return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const body = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAAD(Buffer.from(`${VERSION}:${owner}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong owner, or tampered bytes — all the same answer.
    return null;
  }
}

/**
 * A safe display hint: last 4 characters, everything else masked.
 *
 * This is the ONLY form of a stored secret that may reach a client. It
 * exists so the editor can show "•••• 4f2a — replace?" and let someone
 * confirm which key is installed without the key ever leaving the server.
 */
export function hint(plaintext: string): string {
  const s = String(plaintext ?? "");
  if (s.length <= 4) return "••••";
  return `•••• ${s.slice(-4)}`;
}

/**
 * Constant-time compare for webhook signatures and the like.
 *
 * Length is compared first and non-constant-time, which is fine — the
 * length of a signature isn't the secret. What must not leak is WHERE two
 * equal-length values diverge, and timingSafeEqual covers that.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
