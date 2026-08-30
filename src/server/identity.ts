/**
 * Derived identity — no signup, no stored secret.
 *
 * A visitor picks a nickname and a salt. The client derives
 *   hash = BLAKE2b-256(nickname \x1f salt)
 * and posts it alongside their content. The server stores the hash. That is
 * the whole account system.
 *
 * WHAT THE SERVER CANNOT DO, BY CONSTRUCTION: it cannot recover the salt, so
 * it cannot impersonate a visitor, reset an identity, or be compelled to hand
 * over credentials it never held. Lose the salt and the identity is gone —
 * stated up front, not discovered later.
 *
 * WHAT THIS IS NOT: authentication. Anyone who learns a nickname+salt pair can
 * post as that identity, and the server cannot tell them apart — exactly like
 * a shared password with no reset. That is the accepted trade for zero PII at
 * this stage, and the UI must say so rather than implying account security.
 * Verified sessions (a signature over a server nonce) are a later phase; the
 * shape here does not preclude them.
 *
 * The derivation is duplicated client-side. This module is the authority for
 * the FORMAT — the server validates and displays, and never derives, because
 * deriving would require receiving the salt.
 */

import { createHash } from "node:crypto";

/** Hex length of a BLAKE2b-256 digest. */
const HASH_HEX_LEN = 64;

/** Visible in a handle: nick#<SHORT_LEN hex>. Long enough to distinguish, short enough to read. */
export const SHORT_LEN = 6;

export const NICKNAME_MAX = 24;
const NICKNAME_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;

/** Unit separator between fields so "ab"+"c" and "a"+"bc" cannot collide. */
const FIELD_SEP = "\x1f";

export interface DerivedIdentity {
  /** Full hex digest — the stored identity. */
  hash: string;
  /** Display handle: nickname#abc123. */
  handle: string;
  /** Deterministic hue 0-359 for the identicon and accent color. */
  hue: number;
}

/**
 * Normalize a nickname to its canonical form: trimmed, lowercased.
 *
 * Case-folding matters — "Mark" and "mark" must derive the SAME identity or a
 * visitor who capitalizes differently silently becomes a stranger.
 */
export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function validNickname(nickname: string): boolean {
  return NICKNAME_RE.test(normalizeNickname(nickname));
}

export function validIdentityHash(hash: string): boolean {
  return new RegExp(`^[0-9a-f]{${HASH_HEX_LEN}}$`).test(hash);
}

/**
 * Derive an identity from nickname + salt.
 *
 * Server-side this exists for TESTS and for tooling — never for a request
 * handler, because a handler receiving a salt would defeat the entire design.
 *
 * NOTE ON THE PRIMITIVE: BLAKE2b-256 is a fast hash, not a password KDF. A
 * weak salt is therefore brute-forceable by anyone holding the public hash.
 * That is acceptable only because the hash grants no privileges beyond posting
 * under a nickname — there is nothing of value behind it. If identities ever
 * gain privileges, this must become a memory-hard KDF (Argon2id) first.
 */
export function deriveIdentity(nickname: string, salt: string): DerivedIdentity {
  const nick = normalizeNickname(nickname);
  if (!validNickname(nick)) {
    throw new Error(
      `invalid nickname "${nickname}" — 2-${NICKNAME_MAX} chars, lowercase letters, ` +
        `digits, hyphen or underscore, must start alphanumeric`,
    );
  }
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("salt must be a non-empty string");
  }
  const hash = createHash("blake2b512")
    .update(`${nick}${FIELD_SEP}${salt}`)
    .digest("hex")
    .slice(0, HASH_HEX_LEN);
  return { hash, handle: formatHandle(nick, hash), hue: hueFromHash(hash) };
}

export function formatHandle(nickname: string, hash: string): string {
  return `${normalizeNickname(nickname)}#${hash.slice(0, SHORT_LEN)}`;
}

/** Stable hue from a hash — same identity, same color, everywhere, forever. */
export function hueFromHash(hash: string): number {
  return parseInt(hash.slice(0, 4), 16) % 360;
}

/**
 * Split a stored handle back into parts for display.
 * Returns null on anything malformed rather than guessing at intent.
 */
export function parseHandle(handle: string): { nickname: string; short: string } | null {
  const m = handle.match(new RegExp(`^([a-z0-9][a-z0-9_-]{1,23})#([0-9a-f]{${SHORT_LEN}})$`));
  return m ? { nickname: m[1], short: m[2] } : null;
}
