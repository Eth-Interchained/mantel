import React, { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";

import { getJson, postJson } from "../lib/api";

/**
 * Pending sales — the seller's half of the Tier-1 loop.
 *
 * A buyer pays the seller's UPI directly and submits the reference number
 * their bank gave them. Nothing about that is verified: the platform has
 * no callback and no view into anyone's bank. This panel therefore does
 * exactly one thing — it shows the seller what to go look for, and lets
 * them record the answer.
 *
 * Every word here is chosen to keep that straight. The row says "claims",
 * the button says "I see it — deliver", and confirming is described as
 * releasing the file, never as receiving money. If this panel ever implies
 * the payment is confirmed before the seller says so, it is lying on our
 * behalf to someone about to give away a product for free.
 */

export interface Purchase {
  purchaseId: string;
  title: string;
  price: number;
  reference: string;
  buyerEmail: string;
  /** Bookings: the time the buyer picked. Held until confirmed. */
  slot?: string;
  status: "claimed" | "delivered" | "rejected";
  createdAt: string;
  settledAt?: string;
}

export function SalesPanel({ identityId, canSettle }: { identityId: string; canSettle: boolean }): React.ReactElement | null {
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await getJson<{ purchases: Purchase[] }>(
        `/api/identities/${encodeURIComponent(identityId)}/purchases`,
      );
      setRows(j.purchases ?? []);
    } catch {
      // A seller with no products has nothing to see here; a fetch failure
      // shouldn't plant an error banner on an unrelated editing session.
      setRows([]);
    }
  }, [identityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = async (id: string, action: "confirm" | "reject"): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await postJson(`/api/identities/${encodeURIComponent(identityId)}/purchases/${encodeURIComponent(id)}/${action}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't update that sale");
    } finally {
      setBusy(null);
    }
  };

  // Nothing sold yet, nothing to explain — stay out of the way entirely.
  if (!rows || rows.length === 0) return null;

  const pending = rows.filter((r) => r.status === "claimed");
  const settled = rows.filter((r) => r.status !== "claimed");

  return (
    <div>
      <div className="mb-3 px-1 flex items-end justify-between gap-3">
        <div>
          <h2 className="section-title">Sales</h2>
          <p className="section-desc">
            Buyers pay your UPI directly. Check each reference in your own bank app, then release the file.
          </p>
        </div>
        <button onClick={() => void load()} className="icon-btn" title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="panel p-5 sm:p-6 grid gap-4">
        {error && <p className="text-signal-red text-sm">{error}</p>}

        {pending.length > 0 ? (
          <div className="grid gap-2.5">
            {pending.map((p) => (
              <div
                key={p.purchaseId}
                className="rounded-2xl border border-signal-amber/40 bg-signal-amber/5 p-4 grid gap-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{p.title}</p>
                    <p className="text-xs text-fg-muted mt-0.5">
                      {p.buyerEmail} · claims to have sent{" "}
                      <b className="text-fg">₹{String(p.price).replace(/\.00$/, "")}</b>
                    </p>
                    {p.slot && (
                      // The time is the thing the seller has to actually
                      // show up for, so it gets its own line, not a suffix.
                      <p className="text-xs mt-1">
                        <span className="text-fg-subtle">slot held · </span>
                        <b className="text-fg">{p.slot}</b>
                      </p>
                    )}
                  </div>
                  <span className="chip !text-[10px] font-bold uppercase tracking-wider text-signal-amber shrink-0">
                    awaiting your check
                  </span>
                </div>

                {/* The reference is the whole job: it's what the seller
                    pastes into their bank's search box. Monospace and
                    selectable, not decorative. */}
                <div className="flex items-center gap-2 bg-ink-850 border border-ink-800 rounded-xl px-3 py-2">
                  <span className="text-[11px] text-fg-subtle shrink-0">UPI ref</span>
                  <code className="font-mono text-sm text-fg select-all break-all">{p.reference}</code>
                </div>

                {canSettle ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void settle(p.purchaseId, "confirm")}
                      disabled={busy === p.purchaseId}
                      className="btn btn-primary !py-2.5 !text-sm"
                    >
                      <Check size={15} /> {p.slot ? "I see it — confirm" : "I see it — deliver"}
                    </button>
                    <button
                      onClick={() => void settle(p.purchaseId, "reject")}
                      disabled={busy === p.purchaseId}
                      className="btn btn-secondary !py-2.5 !text-sm"
                    >
                      <X size={15} /> Not in my bank
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-fg-subtle">Only the page owner can release a sale.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Nothing waiting on you.</p>
        )}

        {settled.length > 0 && (
          <div className="grid gap-1.5 pt-1">
            {settled.slice(0, 8).map((p) => (
              <div key={p.purchaseId} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-fg-muted truncate">
                  {p.title} · <code className="font-mono">{p.reference}</code>
                </span>
                <span
                  className={`shrink-0 font-semibold ${
                    p.status === "delivered" ? "text-signal-green" : "text-fg-subtle"
                  }`}
                >
                  {p.status === "delivered" ? "delivered" : "rejected"}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-fg-subtle leading-relaxed">
          We can&apos;t see your bank — a UPI link has no callback, so only you can tell whether the
          money landed. Confirming emails the buyer your delivery link immediately.
        </p>
      </div>
    </div>
  );
}
