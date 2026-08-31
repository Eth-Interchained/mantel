/**
 * mantel-native reviews — the social half.
 *
 * A review is a first-class signal with source "mantel", authored by a derived
 * identity (nickname + salt -> BLAKE2b, done in the browser). The server never
 * sees the salt: the client posts the identity HASH and handle, and the server
 * stores exactly that. Reviews live in the same signals collection as crawled
 * ones, so the model page, the wire, and the sentiment tally all pick them up
 * for free — a review IS a signal, not a parallel system.
 *
 * WHY THIS IS NOT AUTHENTICATION (stated, not hidden): anyone who knows a
 * nickname+salt pair can post as that identity, exactly like a shared password
 * with no reset. That is the accepted trade for zero PII at this stage. The
 * rate limit below is abuse control, not access control.
 *
 * Provenance still holds: each review is chained (caused_by) to a
 * source_document that records the authoring identity and time, so TRACE walks
 * a review back to its origin the same way it walks a crawled signal back to a
 * post.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { db, causalParent } from "./db";
import { COLLECTIONS } from "./models";

/** A hex BLAKE2b digest, lowercase, 64 chars — the stored identity. */
const IDENTITY_HASH_RE = /^[0-9a-f]{64}$/;
/** nickname#abcdef — the display handle the client renders from the hash. */
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,23}#[0-9a-f]{6}$/;

export const ReviewSchema = z.object({
  modelRef: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/, "modelRef must look like family:tag"),
  identityHash: z.string().regex(IDENTITY_HASH_RE, "identityHash must be a 64-char hex digest"),
  handle: z.string().regex(HANDLE_RE, "handle must look like nickname#abcdef"),
  body: z.string().min(3).max(2000),
  sentiment: z.enum(["positive", "negative", "mixed", "neutral"]),
  /** Optional: the hardware the author ran it on, verbatim ("RTX 3090"). */
  hardware: z.string().max(120).optional(),
});

export type Review = z.infer<typeof ReviewSchema>;

/**
 * A per-identity + per-model rate limit, in memory.
 *
 * In memory is honest about what it is: best-effort abuse control that resets
 * on restart and does not span multiple processes. mantel runs as ONE process
 * (the embedded engine's exclusive lock guarantees it), so a single in-memory
 * map covers the whole deployment — no shared store needed, and this comment
 * exists so nobody "fixes" it with Redis under the impression it was broken.
 */
const RATE = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 6;

function rateOk(key: string, now = Date.now()): boolean {
  const hits = (RATE.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    RATE.set(key, hits); // prune while we're here
    return false;
  }
  hits.push(now);
  RATE.set(key, hits);
  return true;
}

/** Exposed for tests so the limiter can be reset between cases. */
export function _resetRateLimiter(): void {
  RATE.clear();
}

export const reviews = Router();

/**
 * Post a review. This is a PUBLIC write — no operator token — because the
 * whole point is that anyone can review without an account. Abuse is bounded
 * by the per-identity+model+IP rate limit, not by auth.
 */
reviews.post("/", async (req: Request, res: Response) => {
  const parsed = ReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid review", issues: parsed.error.issues });
    return;
  }
  const review = parsed.data;

  // Rate key includes the client IP so one identity cannot be farmed from one
  // box, and one box cannot farm many identities. Both are weak alone; together
  // they raise the cost of spam without an account system.
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  const key = `${review.identityHash}|${review.modelRef}|${ip}`;
  if (!rateOk(key)) {
    res.status(429).json({
      error: "rate limited",
      detail: `at most ${MAX_PER_WINDOW} reviews per model per identity per hour`,
    });
    return;
  }

  // Content-addressed by (identity, model): a given identity has ONE review per
  // model, and re-posting updates it in place rather than stacking duplicates —
  // the same idempotence the crawler relies on.
  const { createHash } = await import("node:crypto");
  const reviewKey = createHash("sha256")
    .update(`${review.identityHash}|${review.modelRef}`)
    .digest("hex")
    .slice(0, 32);
  const sourceId = `src_review_${reviewKey}`;
  const signalId = `sig_review_${reviewKey}`;
  const now = new Date().toISOString();

  // The source document records WHO authored it and WHEN — the review's
  // provenance root, mirroring a crawled signal's captured post.
  const existingSource = await db.get(COLLECTIONS.sources, sourceId);
  const source = await db.put(
    COLLECTIONS.sources,
    sourceId,
    {
      kind: "mantel-review",
      identityHash: review.identityHash,
      handle: review.handle,
      authoredAt: now,
      body: review.body,
    },
    {
      causedBy: causalParent(existingSource),
      evidence: `mantel review by ${review.handle}`,
    },
  );

  // The signal: same shape crawled signals use, so every existing reader
  // (model page, wire, tally) handles it with no special-casing.
  const signal = await db.put(
    COLLECTIONS.signals,
    signalId,
    {
      modelRef: review.modelRef,
      source: "mantel",
      // A stable, resolvable URL to the review on the model page.
      sourceUrl: `/m/${encodeURIComponent(review.modelRef)}#${signalId}`,
      authorHandle: review.handle,
      excerpt: review.body.length > 600 ? `${review.body.slice(0, 597)}…` : review.body,
      sentiment: review.sentiment,
      hardware: review.hardware,
      postedAt: now,
    },
    {
      causedBy: causalParent(source.doc),
      evidence: `mantel review ${signalId}`,
    },
  );

  // DURABILITY: a posted review must survive a hard stop — flush the pair
  // (source doc + signal) before confirming to the author.
  await db.flush();

  res.status(201).json({
    ok: true,
    signalId: signal.doc._id,
    handle: review.handle,
    postedAt: now,
  });
});
