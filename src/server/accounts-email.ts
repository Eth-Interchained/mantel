/**
 * Email-mode accounts — the ne-db.com product (LINKS_AUTH_MODE=email).
 *
 * No wallet anywhere: no seed phrases, no addresses, no crypto
 * vocabulary. Accounts are email + password; recovery is the familiar
 * "forgot password nonsense" — deliberately boring, deliberately
 * trustworthy.
 *
 *   POST /api/auth/signup         {email, password} → verify email sent
 *   POST /api/auth/verify-email   {token}           → verified + signed in
 *   POST /api/auth/login          {email, password} → session
 *   POST /api/auth/forgot         {email}           → always 200 (no enumeration)
 *   POST /api/auth/reset          {token, password} → password set, sessions revoked
 *   POST /api/auth/resend-verify  {email}           → always 200
 *   POST /api/auth/logout                           → session revoked
 *
 * The principal is `eml_` + sha256(email)[:20] — an opaque string that
 * rides the EXISTING sessions/grants/entitlements plumbing untouched.
 * Passwords are scrypt (node crypto, zero new deps): N=16384 r=8 p=1,
 * 16-byte salt, 32-byte key, constant-time compare, parameters recorded
 * in the hash so future upgrades still verify old records.
 *
 * Verify/reset tokens reuse the wallet challenge pattern: engine docs,
 * 30-minute TTL, single-use, tombstoned on redemption.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { Router } from "express";
import { z } from "zod";

import {
  COLLECTIONS,
  type AccountRecord,
  type IdentityManifest,
} from "../lib/identity";
import { buildQrPng, shareUrl } from "../lib/renderers/qr";
import { sha256Hex } from "../lib/wallet";
import {
  magicLoginEmail,
  publishedEmail,
  receiptEmail,
  resetEmail,
  verifyEmail,
  welcomeEmail,
} from "./emails";
import { issueSession } from "./auth";
import { causalParent, db } from "./db";
import { config } from "./config";
import { sendMail } from "./mailer";
import { wrap } from "./util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const TOKEN_TTL_MS = 30 * 60 * 1000;

// ── Principals & passwords ───────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** eml_<sha256(email)[:20]> — same opaque-principal contract as itc1…,
 *  so grants, sessions, and entitlements need zero changes. */
export function emailPrincipal(email: string): string {
  return `eml_${createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 20)}`;
}

const SCRYPT = { N: 16384, r: 8, p: 1 } as const; // fits node's default maxmem

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash to verify against when the account doesn't exist — keeps
// login timing flat so addresses can't be enumerated by stopwatch.
const DUMMY_HASH_PROMISE = hashPassword("timing-equalizer-not-a-real-account");

// ── Accounts & tokens ────────────────────────────────────────────────────────

async function getAccount(principal: string): Promise<AccountRecord | null> {
  const doc = await db.get(COLLECTIONS.accounts, principal);
  return (doc as AccountRecord | null) ?? null;
}

interface MailToken {
  challengeId: string;
  kind: "email_verify" | "pw_reset";
  principal: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

async function mintToken(kind: MailToken["kind"], account: AccountRecord): Promise<string> {
  const id = `tok_${randomBytes(16).toString("hex")}`;
  const now = Date.now();
  const doc: MailToken = {
    challengeId: id,
    kind,
    principal: account.principal,
    email: account.email,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
  };
  await db.put(COLLECTIONS.challenges, id, doc as unknown as Record<string, unknown>, {
    evidence: `${kind} token for ${account.principal}`,
  });
  return id;
}

/** Redeem-once: validates kind + TTL, tombstones, returns the token doc. */
async function redeemToken(id: string, kind: MailToken["kind"]): Promise<MailToken | null> {
  const doc = (await db.get(COLLECTIONS.challenges, id)) as MailToken | null;
  if (!doc || doc.kind !== kind) return null;
  if (new Date(doc.expiresAt).getTime() < Date.now()) return null;
  await db.delete(COLLECTIONS.challenges, id);
  return doc;
}

function origin(): string {
  return config.publicOrigin || "http://localhost:3000";
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const accountsEmail = Router();

const credsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "password must be at least 8 characters").max(200),
});

/** POST /signup — create the account, send the confirm email. */
accountsEmail.post("/signup", wrap(async (req, res) => {
  const body = credsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "invalid email or password" });
    return;
  }
  const email = normalizeEmail(body.data.email);
  const principal = emailPrincipal(email);
  const existing = await getAccount(principal);

  if (existing?.verifiedAt) {
    res.status(409).json({ error: "an account with this email already exists — sign in instead" });
    return;
  }

  // New signup, or an unverified retry (maybe the mail got lost, maybe
  // they typo'd the password last time) — refresh the record either way.
  const account: AccountRecord = {
    principal,
    email,
    passwordHash: await hashPassword(body.data.password),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await db.put(COLLECTIONS.accounts, principal, account as unknown as Record<string, unknown>, {
    causedBy: causalParent(existing as unknown as Record<string, unknown> | null),
    evidence: `signup: ${principal}`,
  });

  const token = await mintToken("email_verify", account);
  try {
    await sendMail(verifyEmail({ to: email, verifyUrl: `${origin()}/verify?token=${token}` }));
  } catch (err) {
    console.error(`[links] verify email send failed: ${err instanceof Error ? err.message : err}`);
    res.status(502).json({
      error: "we couldn't send the confirmation email — try again in a moment",
    });
    return;
  }
  res.status(201).json({ ok: true, needsVerify: true });
}));

/** POST /verify-email — confirm the address; signs the user straight in. */
accountsEmail.post("/verify-email", wrap(async (req, res) => {
  const body = z.object({ token: z.string().min(8).max(80) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid token" });
    return;
  }
  const tok = await redeemToken(body.data.token, "email_verify");
  if (!tok) {
    res.status(401).json({ error: "this confirmation link is invalid or expired — request a new one" });
    return;
  }
  const account = await getAccount(tok.principal);
  if (!account) {
    res.status(401).json({ error: "account not found" });
    return;
  }
  if (!account.verifiedAt) {
    const next: AccountRecord = { ...account, verifiedAt: new Date().toISOString() };
    await db.put(COLLECTIONS.accounts, account.principal, next as unknown as Record<string, unknown>, {
      causedBy: causalParent(account as unknown as Record<string, unknown>),
      evidence: `email verified: ${account.principal}`,
    });
    // The one-time welcome — a receipt path, never a blocker.
    sendMail(welcomeEmail({ to: account.email, claimUrl: `${origin()}/` })).catch((err) =>
      console.warn(`[links] welcome email failed: ${err instanceof Error ? err.message : err}`),
    );
  }
  const session = await issueSession(account.principal);
  res.json({ token: session.token, address: account.principal, email: account.email, expiresAt: session.expiresAt });
}));

/** POST /login — verified accounts only; timing-flat on unknown emails. */
accountsEmail.post("/login", wrap(async (req, res) => {
  const body = credsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid email or password" });
    return;
  }
  const principal = emailPrincipal(body.data.email);
  const account = await getAccount(principal);

  const hash = account?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const ok = await verifyPassword(body.data.password, hash);
  if (!account || !ok) {
    res.status(401).json({ error: "wrong email or password" });
    return;
  }
  if (!account.verifiedAt) {
    res.status(403).json({ error: "confirm your email first — check your inbox", needsVerify: true });
    return;
  }
  const session = await issueSession(account.principal);
  res.json({ token: session.token, address: account.principal, email: account.email, expiresAt: session.expiresAt });
}));

/** POST /forgot — ALWAYS 200. Whether the account exists is not a
 *  question this endpoint answers. */
accountsEmail.post("/forgot", wrap(async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(req.body);
  if (body.success) {
    const account = await getAccount(emailPrincipal(body.data.email));
    if (account) {
      const token = await mintToken("pw_reset", account);
      sendMail(resetEmail({ to: account.email, resetUrl: `${origin()}/reset?token=${token}` })).catch(
        (err) => console.error(`[links] reset email failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }
  res.json({ ok: true });
}));

/** POST /reset — set a new password; every existing session is revoked. */
accountsEmail.post("/reset", wrap(async (req, res) => {
  const body = z
    .object({ token: z.string().min(8).max(80), password: z.string().min(8).max(200) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "invalid request" });
    return;
  }
  const tok = await redeemToken(body.data.token, "pw_reset");
  if (!tok) {
    res.status(401).json({ error: "this reset link is invalid or expired — request a new one" });
    return;
  }
  const account = await getAccount(tok.principal);
  if (!account) {
    res.status(401).json({ error: "account not found" });
    return;
  }
  const next: AccountRecord = {
    ...account,
    passwordHash: await hashPassword(body.data.password),
    // A reset also proves mailbox control — verify if not already.
    verifiedAt: account.verifiedAt ?? new Date().toISOString(),
  };
  await db.put(COLLECTIONS.accounts, account.principal, next as unknown as Record<string, unknown>, {
    causedBy: causalParent(account as unknown as Record<string, unknown>),
    evidence: `password reset: ${account.principal}`,
  });

  // Revoke every session for this principal — a reset means "lock it down".
  try {
    const sessions = await db.query(
      `FROM ${COLLECTIONS.sessions} WHERE address = '${account.principal}'`,
    );
    await Promise.all(
      sessions
        .map((s) => (s as { tokenHash?: string }).tokenHash)
        .filter((h): h is string => typeof h === "string")
        .map((h) => db.delete(COLLECTIONS.sessions, h)),
    );
  } catch (err) {
    console.warn(`[links] session revocation sweep failed: ${err instanceof Error ? err.message : err}`);
  }

  const session = await issueSession(account.principal);
  res.json({ token: session.token, address: account.principal, email: account.email, expiresAt: session.expiresAt });
}));

/** POST /resend-verify — always 200; resends only where it makes sense. */
accountsEmail.post("/resend-verify", wrap(async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(req.body);
  if (body.success) {
    const account = await getAccount(emailPrincipal(body.data.email));
    if (account && !account.verifiedAt) {
      const token = await mintToken("email_verify", account);
      sendMail(verifyEmail({ to: account.email, verifyUrl: `${origin()}/verify?token=${token}` })).catch(
        (err) => console.error(`[links] verify resend failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }
  res.json({ ok: true });
}));

// ── Magic sign-in: one email, two redemptions (link OR code) ────────────────

const MAGIC_TTL_MS = 15 * 60 * 1000;
const magicWindows = new Map<string, number[]>();

function magicThrottleOk(principal: string, now = Date.now()): boolean {
  const hits = (magicWindows.get(principal) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) {
    magicWindows.set(principal, hits);
    return false;
  }
  hits.push(now);
  magicWindows.set(principal, hits);
  return true;
}

interface MagicToken {
  kind: "magic_login";
  principal: string;
  email: string;
  /** Unguessable link token (the URL carries this, not the doc id). */
  linkToken: string;
  /** Six digits for cross-device sign-in. */
  code: string;
  createdAt: string;
  expiresAt: string;
}

function magicId(principal: string): string {
  return `magic_${principal}`;
}

/** POST /magic {email} — ALWAYS 200; mints and mails for verified
 *  accounts only. Re-requesting replaces the previous token. */
accountsEmail.post("/magic", wrap(async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(req.body);
  if (body.success) {
    const principal = emailPrincipal(body.data.email);
    const account = await getAccount(principal);
    if (account?.verifiedAt && magicThrottleOk(principal)) {
      const now = Date.now();
      const doc: MagicToken = {
        kind: "magic_login",
        principal,
        email: account.email,
        linkToken: `tok_${randomBytes(16).toString("hex")}`,
        code: String(Math.floor(100000 + Math.random() * 900000)),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + MAGIC_TTL_MS).toISOString(),
      };
      await db.put(COLLECTIONS.challenges, magicId(principal), doc as unknown as Record<string, unknown>, {
        evidence: `magic login for ${principal}`,
      });
      sendMail(
        magicLoginEmail({
          to: account.email,
          loginUrl: `${origin()}/magic?token=${doc.linkToken}`,
          code: doc.code,
        }),
      ).catch((err) =>
        console.error(`[links] magic email failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }
  res.json({ ok: true });
}));

async function redeemMagic(doc: MagicToken | null): Promise<{ token: string; expiresAt: string } | null> {
  if (!doc || doc.kind !== "magic_login") return null;
  if (new Date(doc.expiresAt).getTime() < Date.now()) return null;
  // Single-use: tombstone before issuing.
  await db.delete(COLLECTIONS.challenges, magicId(doc.principal));
  return issueSession(doc.principal);
}

/** POST /magic-redeem — {token} from the emailed link, OR {email, code}
 *  typed on another device. One endpoint, two shapes, one tombstone. */
accountsEmail.post("/magic-redeem", wrap(async (req, res) => {
  const body = z
    .object({
      token: z.string().min(8).max(80).optional(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      code: z.string().regex(/^\d{6}$/).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid request" });
    return;
  }

  let doc: MagicToken | null = null;
  if (body.data.token) {
    const rows = await db.query(
      `FROM ${COLLECTIONS.challenges} WHERE linkToken = '${body.data.token.replace(/[^a-z0-9_]/gi, "")}' LIMIT 1`,
    );
    doc = (rows[0] as unknown as MagicToken | undefined) ?? null;
  } else if (body.data.email && body.data.code) {
    const principal = emailPrincipal(body.data.email);
    const found = (await db.get(COLLECTIONS.challenges, magicId(principal))) as MagicToken | null;
    if (found) {
      const a = Buffer.from(String(found.code));
      const b = Buffer.from(body.data.code);
      if (a.length === b.length && timingSafeEqual(a, b)) doc = found;
    }
  }

  const session = await redeemMagic(doc);
  if (!session || !doc) {
    res.status(401).json({ error: "that sign-in link or code is invalid or expired — request a new one" });
    return;
  }
  res.json({ token: session.token, address: doc.principal, email: doc.email, expiresAt: session.expiresAt });
}));

/** POST /logout — same contract as wallet mode. */
accountsEmail.post("/logout", wrap(async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    await db.delete(COLLECTIONS.sessions, sha256Hex(token)).catch(() => false);
  }
  res.json({ ok: true });
}));

// ── Receipt hooks (email mode only; fire-and-forget by contract) ────────────

/** After a publish: "@handle is live" with the print-grade QR inlined. */
export function maybeSendPublishedEmail(manifest: IdentityManifest, principal: string): void {
  if (config.authMode !== "email" || !principal.startsWith("eml_")) return;
  void (async () => {
    const account = await getAccount(principal);
    if (!account?.verifiedAt) return;
    const profileUrl = `${origin()}/${manifest.handle}`;
    const qr = await buildQrPng(shareUrl(manifest, origin()), 512);
    await sendMail(
      publishedEmail({
        to: account.email,
        handle: manifest.handle,
        profileUrl,
        qrPng: Buffer.from(qr),
      }),
    );
  })().catch((err) =>
    console.warn(`[links] published email failed: ${err instanceof Error ? err.message : err}`),
  );
}

/** After a supporter payment lands: the receipt. */
export function maybeSendReceiptEmail(principal: string, amountCents: number, currency: string): void {
  if (config.authMode !== "email" || !principal.startsWith("eml_")) return;
  void (async () => {
    const account = await getAccount(principal);
    if (!account) return;
    await sendMail(receiptEmail({ to: account.email, amountCents, currency }));
  })().catch((err) =>
    console.warn(`[links] receipt email failed: ${err instanceof Error ? err.message : err}`),
  );
}
