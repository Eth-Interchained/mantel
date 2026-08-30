/**
 * Operator console — the whole instance, not one creator's corner.
 *
 * Everything else in this app is scoped to what a signed-in person owns
 * or was granted. This is the one surface that reads across all of it, so
 * it is gated on `requireOperator` (LINKS_ADMIN_TOKEN) and nothing less.
 * Until now that gate existed and guarded nothing.
 *
 * Same dogfooding rule as creator analytics: every number here is a live
 * NQL aggregation over the append-only log at request time. No counter
 * documents, nothing precomputed, nothing to drift.
 *
 * ONE THING THIS PANEL MUST NEVER IMPLY
 * The rupee figures are what CREATORS were paid, straight to their own
 * banks. Interchained is not the merchant, takes no cut, and holds none
 * of it — so this is not revenue, and the field is named `creatorEarnings`
 * rather than anything that would read like ours on a dashboard someone
 * screenshots a year from now. `delivered` is the honest number; `claimed`
 * is unverified by construction.
 *
 *   GET /api/admin/overview   instance totals, commerce, top pages
 *   GET /api/admin/events     the recent activity feed
 */

import { Router } from "express";

import { COLLECTIONS, type IdentityManifest } from "../lib/identity";
import { requireOperator } from "./auth";
import { config } from "./config";
import { db } from "./db";
import { isConfigured as vaultReady } from "./secretbox";
import { wrap } from "./util";
import type { PurchaseDoc } from "./purchases";

export const admin = Router();

/** Cap every scan: an operator page must not be able to melt the engine. */
const SCAN = 5000;

interface EventRow {
  kind?: unknown;
  identityId?: unknown;
  amount?: unknown;
  source?: unknown;
  ts?: unknown;
}

function count<T>(rows: T[], pred: (r: T) => boolean): number {
  return rows.reduce((n, r) => (pred(r) ? n + 1 : n), 0);
}

admin.get("/overview", requireOperator, wrap(async (_req, res) => {
  const [identities, purchaseRows, eventRows, accountRows] = await Promise.all([
    db.query(`FROM ${COLLECTIONS.identities} LIMIT ${SCAN}`) as Promise<unknown[]>,
    db.query(`FROM ${COLLECTIONS.purchases} LIMIT ${SCAN}`) as Promise<unknown[]>,
    db.query(`FROM ${COLLECTIONS.events} LIMIT ${SCAN}`) as Promise<unknown[]>,
    db.query(`FROM ${COLLECTIONS.accounts} LIMIT ${SCAN}`) as Promise<unknown[]>,
  ]);

  const manifests = identities as IdentityManifest[];
  const purchases = purchaseRows as PurchaseDoc[];
  const events = eventRows as EventRow[];

  const kind = (k: string): number => count(events, (e) => e.kind === k);
  const money = (pred: (p: PurchaseDoc) => boolean): number =>
    purchases.reduce((n, p) => (pred(p) ? n + (Number(p.price) || 0) : n), 0);

  // Per-identity view counts, so the operator can see which pages carry
  // the instance rather than only the aggregate.
  const viewsBy = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "profile_view") continue;
    const id = String(e.identityId ?? "");
    if (id) viewsBy.set(id, (viewsBy.get(id) ?? 0) + 1);
  }
  const topPages = manifests
    .map((m) => ({
      identityId: m.identityId,
      handle: m.handle,
      displayName: m.displayName,
      status: m.status,
      views: viewsBy.get(m.identityId) ?? 0,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);

  res.json({
    instance: {
      brand: config.brandName,
      brandKey: config.brandKey,
      currency: config.currency,
      authMode: config.authMode,
      // Operational flags an operator actually needs to see at a glance —
      // never the values behind them.
      vaultReady: vaultReady(),
      fiatDoor: Boolean(config.stripeSecretKey),
      limitEnabled: config.limitEnabled,
    },
    totals: {
      accounts: accountRows.length,
      identities: manifests.length,
      published: count(manifests, (m) => m.status === "published"),
      drafts: count(manifests, (m) => m.status !== "published"),
    },
    traffic: {
      views: kind("profile_view"),
      linkClicks: kind("link_click"),
      vcardDownloads: kind("vcard_download"),
    },
    commerce: {
      claimed: count(purchases, (p) => p.status === "claimed"),
      delivered: count(purchases, (p) => p.status === "delivered"),
      rejected: count(purchases, (p) => p.status === "rejected"),
      bookings: count(purchases, (p) => Boolean(p.slot)),
      /** Paid straight to creators' own banks. NOT our revenue — we take none. */
      creatorEarnings: money((p) => p.status === "delivered"),
      /** Unverified by construction: a buyer's assertion, not a payment. */
      claimedValue: money((p) => p.status === "claimed"),
    },
    topPages,
    /** True when a scan hit the cap — the numbers below it are a floor. */
    truncated: {
      identities: manifests.length >= SCAN,
      purchases: purchases.length >= SCAN,
      events: events.length >= SCAN,
    },
  });
}));

admin.get("/events", requireOperator, wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = (await db.query(`FROM ${COLLECTIONS.events} LIMIT ${SCAN}`)) as EventRow[];
  // Newest first. Sorted app-side: ORDER BY on this engine returns []
  // silently for grouped/large scans (see analytics.ts for the same note).
  const feed = rows
    .filter((r) => typeof r.ts === "string")
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
  res.json({ events: feed, scanned: rows.length, truncated: rows.length >= SCAN });
}));
