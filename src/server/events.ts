/**
 * The event log — one append-only stream, one way to write it.
 *
 * Analytics in this product is not a counter table that drifts: the
 * events collection IS the store, and every number on every dashboard is
 * a live NQL aggregation over it. That only holds if writes go through
 * one place, so this module exists to stop a second, subtly different
 * `track()` growing somewhere else.
 *
 * Fire-and-forget on purpose. A failed analytics write must never block a
 * render, a purchase, or a delivery — losing a data point is annoying,
 * failing a sale because the log hiccuped is unforgivable.
 */

import { randomUUID } from "node:crypto";

import { COLLECTIONS } from "../lib/identity";
import { db } from "./db";

/**
 * Every event kind the product emits.
 *
 * Kept as a closed union so a typo can't quietly create a new kind that
 * no dashboard ever counts — the exact failure mode that made the
 * commerce work invisible to analytics for five PRs.
 */
export type EventKind =
  | "profile_view"
  | "link_click"
  | "vcard_download"
  | "qr_scan"
  | "purchase_claimed"
  | "purchase_delivered"
  | "purchase_rejected";

export interface TrackedEvent {
  kind: EventKind;
  identityId?: string;
  blockId?: string;
  source?: string;
  /** Rupees, on commerce events. Never a running total — sum at read time. */
  amount?: number;
  [k: string]: unknown;
}

export function track(event: TrackedEvent): void {
  const id = `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  db.put(COLLECTIONS.events, id, { ...event, ts: new Date().toISOString() }).catch((err) => {
    console.warn(`[links] event write failed: ${err instanceof Error ? err.message : err}`);
  });
}
