/**
 * Tier-2 payment credentials — the creator's OWN provider keys.
 *
 * THE POSITION (Mark, 2026-08-21)
 * "I want the users to be able to process their payments with their own
 * keys, where as we are not intermediary or banking or earning from any
 * payments, just promoting the use of the technology."
 *
 * So: the creator brings their own Razorpay/Cashfree account. We create
 * orders ON THEIR BEHALF with THEIR keys; the money settles into THEIR
 * bank. Interchained is never merchant of record, never takes custody,
 * never takes a cut. What Tier 2 buys over Tier 1 (the plain UPI intent)
 * is the callback: a signed webhook that lets a purchase auto-deliver
 * instead of waiting on a human to eyeball their bank app.
 *
 * WHAT WE HOLD, AND HOW
 *   keyId      — semi-public; it rides in the checkout payload. Stored
 *                in the clear so the UI can show which account is wired.
 *   keySecret  — sealed (AES-256-GCM, owner-bound) via secretbox.
 *   webhookSecret — sealed; verifies the provider's callback signature.
 *
 * Neither sealed value is EVER returned by this API. Reads answer
 * "configured?" plus a last-four hint, nothing more. There is no
 * endpoint that decrypts to a client, by design: the plaintext exists
 * only inside a server-side charge/verify call.
 *
 *   GET    /api/identities/:id/payments   (editor+) → status + hints
 *   PUT    /api/identities/:id/payments   (owner)   → install/replace
 *   DELETE /api/identities/:id/payments   (owner)   → remove entirely
 */

import { Router } from "express";
import { z } from "zod";

import { COLLECTIONS } from "../lib/identity";
import { authOf, requireUser } from "./auth";
import { causalParent, db } from "./db";
import { hasRole } from "./grants";
import { hint, isConfigured, open, seal } from "./secretbox";
import { wrap } from "./util";

export const payments = Router({ mergeParams: true });

/** Providers we can actually verify a webhook from. Extend deliberately. */
export const PSP_PROVIDERS = ["razorpay", "cashfree"] as const;
export type PspProvider = (typeof PSP_PROVIDERS)[number];

export interface PspRecord {
  identityId: string;
  provider: PspProvider;
  /** Semi-public: travels in the checkout payload anyway. */
  keyId: string;
  /** Sealed. Never leaves the server. */
  keySecretSealed: string;
  /** Sealed. Never leaves the server. May be absent until they set it. */
  webhookSecretSealed?: string;
  /** Display-only, computed at write time so reads never touch crypto. */
  keySecretHint: string;
  webhookSecretHint?: string;
  updatedAt: string;
}

function pspId(identityId: string): string {
  return `psp:${identityId}`;
}

export async function getPsp(identityId: string): Promise<PspRecord | null> {
  const doc = await db.get(COLLECTIONS.payments, pspId(identityId));
  return (doc as PspRecord | null) ?? null;
}

/**
 * Server-side ONLY: unseal a creator's credentials to make a call on
 * their behalf. Returns null when unset or unopenable.
 *
 * Every caller of this must treat the result as radioactive: use it in
 * the outbound request, never log it, never put it in an error message,
 * never return it up a response path.
 */
export async function unsealPsp(
  identityId: string,
): Promise<{ provider: PspProvider; keyId: string; keySecret: string; webhookSecret: string | null } | null> {
  const rec = await getPsp(identityId);
  if (!rec) return null;
  const keySecret = open(rec.keySecretSealed, identityId);
  if (!keySecret) return null;
  return {
    provider: rec.provider,
    keyId: rec.keyId,
    keySecret,
    webhookSecret: rec.webhookSecretSealed ? open(rec.webhookSecretSealed, identityId) : null,
  };
}

/** The safe projection — the only shape that may cross the wire. */
function publicView(rec: PspRecord | null): Record<string, unknown> {
  if (!rec) return { configured: false, vaultReady: isConfigured() };
  return {
    configured: true,
    vaultReady: isConfigured(),
    provider: rec.provider,
    keyId: rec.keyId,
    keySecretHint: rec.keySecretHint,
    webhookConfigured: Boolean(rec.webhookSecretSealed),
    webhookSecretHint: rec.webhookSecretHint,
    updatedAt: rec.updatedAt,
  };
}

const putSchema = z.object({
  provider: z.enum(PSP_PROVIDERS),
  // Providers vary; keep the shape loose but bounded, and reject
  // whitespace-only values that would silently "configure" nothing.
  keyId: z.string().trim().min(6).max(120),
  keySecret: z.string().trim().min(8).max(200),
  webhookSecret: z.string().trim().min(8).max(200).optional(),
});

// ── Routes (mounted at /api/identities/:id/payments) ────────────────────────

payments.get("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  // Editor+, not viewer: knowing WHICH payment account is wired to a page
  // is commercially sensitive even without the secret.
  if (!auth || !(await hasRole(identityId, auth, "editor"))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json(publicView(await getPsp(identityId)));
}));

payments.put("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "owner"))) {
    res.status(403).json({ error: "owner role required" });
    return;
  }
  // Refuse rather than degrade. A deployment with no master key must not
  // accept a secret it can only store in the clear.
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "this deployment can't store payment keys yet — LINKS_SECRET_KEY is not configured on the server",
      code: "vault_unconfigured",
    });
    return;
  }
  const body = putSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "invalid payment credentials" });
    return;
  }
  const { provider, keyId, keySecret, webhookSecret } = body.data;
  const prev = await getPsp(identityId);
  const record: PspRecord = {
    identityId,
    provider,
    keyId,
    keySecretSealed: seal(keySecret, identityId),
    keySecretHint: hint(keySecret),
    ...(webhookSecret
      ? { webhookSecretSealed: seal(webhookSecret, identityId), webhookSecretHint: hint(webhookSecret) }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  await db.put(COLLECTIONS.payments, pspId(identityId), record as unknown as Record<string, unknown>, {
    causedBy: causalParent(prev as unknown as Record<string, unknown> | null),
    // Evidence is a permanent, replayable log line. It records THAT keys
    // were installed and by whom — never any part of the keys themselves.
    evidence: `payment keys ${prev ? "replaced" : "installed"} for ${identityId} (${provider})`,
  });
  res.json(publicView(record));
}));

payments.delete("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "owner"))) {
    res.status(403).json({ error: "owner role required" });
    return;
  }
  // Disconnecting is always free and always immediate — a creator must
  // never feel their keys are held hostage by the platform.
  await db.delete(COLLECTIONS.payments, pspId(identityId));
  res.json({ configured: false, vaultReady: isConfigured(), removed: true });
}));
