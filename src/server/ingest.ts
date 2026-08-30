/**
 * Ingestion — the ONLY write path for crawled signals.
 *
 * This is not a stylistic choice. The embedded engine takes an exclusive lock
 * on its data directory and refuses split-brain opens, so a crawler running as
 * a separate process CANNOT write to the store directly. Every signal arrives
 * over this route, authenticated, and is written by the one process that owns
 * the files.
 *
 * Operator-gated: without MANTEL_OPERATOR_TOKEN the route refuses everything
 * rather than running open. A public ingestion endpoint is a spam firehose with
 * cryptographic provenance attached — the worst of both worlds.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { config } from "./config";
import { ModelSchema, SignalSchema, recordSignal, upsertModel } from "./models";

export const ingest = Router();

/**
 * Bearer check.
 *
 * Fails CLOSED when no token is configured, and says which of the two
 * situations occurred — an unconfigured server and a wrong token are different
 * problems for whoever is debugging, and collapsing them into one opaque 401
 * has cost real hours before.
 */
function operatorOnly(req: Request, res: Response, next: NextFunction): void {
  if (!config.operatorToken) {
    console.warn(
      "[mantel] ingest refused: MANTEL_OPERATOR_TOKEN is not set. The route fails " +
        "closed rather than accepting unauthenticated writes.",
    );
    res.status(503).json({
      error: "ingest not configured",
      detail: "MANTEL_OPERATOR_TOKEN is unset on this deployment, so writes are refused",
    });
    return;
  }
  const header = req.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = config.operatorToken;

  // Compare in constant time. Length is compared first because
  // timingSafeEqual throws on a length mismatch — and length alone is not a
  // secret worth protecting here.
  const ok =
    presented.length === expected.length &&
    timingSafeEqual(Buffer.from(presented), Buffer.from(expected));

  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

ingest.use(operatorOnly);

const IngestSignalSchema = z.object({
  signal: SignalSchema,
  raw: z.object({
    capturedAt: z.string().datetime(),
    body: z.string().min(1).max(200_000),
  }),
});

const IngestBatchSchema = z.object({
  signals: z.array(IngestSignalSchema).min(1).max(500),
});

/** Upsert one catalog entry. */
ingest.post("/model", async (req: Request, res: Response) => {
  const parsed = ModelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid model", issues: parsed.error.issues });
    return;
  }
  const doc = await upsertModel(parsed.data);
  res.status(201).json({ ok: true, id: doc._id, seq: doc._seq, hash: doc._hash });
});

/**
 * Record a batch of signals.
 *
 * Partial success is REPORTED, never smoothed over: each entry gets its own
 * result row, and the response carries both counts. A crawler that silently
 * loses 200 of 500 signals is indistinguishable from one that worked, and the
 * next run would happily lose them again.
 */
ingest.post("/signals", async (req: Request, res: Response) => {
  const parsed = IngestBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid batch", issues: parsed.error.issues });
    return;
  }

  const results: {
    sourceUrl: string;
    ok: boolean;
    signalId?: string;
    sourceId?: string;
    error?: string;
  }[] = [];

  for (const entry of parsed.data.signals) {
    try {
      const { signalId, sourceId } = await recordSignal(entry.signal, entry.raw);
      results.push({ sourceUrl: entry.signal.sourceUrl, ok: true, signalId, sourceId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Log server-side too — a caller that ignores the response body must
      // not be the only record that a write failed.
      console.error(
        `[mantel] ingest failed for ${entry.signal.sourceUrl} ` +
          `(model ${entry.signal.modelRef}): ${message}`,
      );
      results.push({ sourceUrl: entry.signal.sourceUrl, ok: false, error: message });
    }
  }

  const written = results.filter((r) => r.ok).length;
  const failed = results.length - written;
  // 207 when the batch was partially applied — a 200 would imply all of it landed.
  res.status(failed === 0 ? 201 : 207).json({
    ok: failed === 0,
    written,
    failed,
    results,
  });
});
