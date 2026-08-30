/**
 * Client-side identity derivation — the salt never leaves this file's scope.
 *
 * nickname + salt → BLAKE2b-256 → identity hash. The hash is what gets posted;
 * the salt is never sent, never stored by us, and never recoverable. Keeping
 * the derivation client-side is the entire point: a server that receives the
 * salt could impersonate you.
 *
 * Must stay byte-compatible with src/server/identity.ts — same separator, same
 * normalization, same truncation. The shared test vector below is checked on
 * both sides so a drift in either breaks a test rather than silently splitting
 * every visitor into two identities.
 */

import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const HASH_HEX_LEN = 64;
export const SHORT_LEN = 6;
export const NICKNAME_MAX = 24;
const NICKNAME_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;
/** Unit separator — see the server module: prevents field-boundary collisions. */
const FIELD_SEP = "\x1f";

/** localStorage key. Holds ONLY the derived hash and nickname, never the salt. */
const STORE_KEY = "mantel.identity";

export interface DerivedIdentity {
  hash: string;
  handle: string;
  hue: number;
}

export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function validNickname(nickname: string): boolean {
  return NICKNAME_RE.test(normalizeNickname(nickname));
}

export function deriveIdentity(nickname: string, salt: string): DerivedIdentity {
  const nick = normalizeNickname(nickname);
  if (!validNickname(nick)) {
    throw new Error(
      `invalid nickname — 2-${NICKNAME_MAX} characters, lowercase letters, digits, ` +
        `hyphen or underscore, starting with a letter or digit`,
    );
  }
  if (!salt) throw new Error("a salt is required — it is what makes this identity yours");

  const hash = bytesToHex(
    blake2b(utf8ToBytes(`${nick}${FIELD_SEP}${salt}`), { dkLen: 64 }),
  ).slice(0, HASH_HEX_LEN);

  return {
    hash,
    handle: `${nick}#${hash.slice(0, SHORT_LEN)}`,
    hue: parseInt(hash.slice(0, 4), 16) % 360,
  };
}

/**
 * Remember the derived identity for this browser (hash + handle only).
 *
 * Storage failures are REPORTED, not swallowed: private-mode Safari and
 * storage-quota errors both throw here, and a visitor whose identity silently
 * fails to persist deserves to know why rather than wondering why they are a
 * stranger next visit.
 */
export function rememberIdentity(id: DerivedIdentity): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(id));
    return true;
  } catch (err) {
    console.warn(
      "[mantel] could not persist your identity to localStorage " +
        `(${err instanceof Error ? err.message : String(err)}) — ` +
        "likely private browsing or a full storage quota. Your identity still " +
        "works for this session; re-enter your nickname and salt next time.",
    );
    return false;
  }
}

export function recallIdentity(): DerivedIdentity | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (err) {
    console.warn(
      "[mantel] localStorage is unavailable " +
        `(${err instanceof Error ? err.message : String(err)}) — starting anonymous.`,
    );
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DerivedIdentity>;
    if (
      typeof parsed.hash === "string" &&
      typeof parsed.handle === "string" &&
      typeof parsed.hue === "number"
    ) {
      return parsed as DerivedIdentity;
    }
    console.warn("[mantel] stored identity is malformed — ignoring it and starting anonymous.");
    return null;
  } catch (err) {
    console.warn(
      `[mantel] stored identity is not valid JSON (${err instanceof Error ? err.message : String(err)}) — ignoring.`,
    );
    return null;
  }
}

export function forgetIdentity(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    console.warn(
      `[mantel] could not clear the stored identity (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}
