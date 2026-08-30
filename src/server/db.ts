/**
 * The single NEDB touchpoint. Every byte of state in NEDB Links flows
 * through nedb-engine-client to a running nedbd — there is no other
 * database, no local store, no cache of record.
 *
 * NEDB stores knowledge. Portal renders experiences. Links publishes identity.
 */

import { NedbClient } from "nedb-engine-client";
import { config } from "./config";

export const db = new NedbClient({
  url: config.nedbUrl,
  db: config.nedbDb,
  token: config.nedbToken,
  autoCreate: true,
});

/** Provenance helper: the _hash of a document's current version, so the
 *  next put can chain causedBy to it. Returns [] for new documents. */
export function causalParent(
  doc: Record<string, unknown> | null,
): string[] {
  const h = doc && typeof doc._hash === "string" ? (doc._hash as string) : null;
  return h ? [h] : [];
}
