import React, { useCallback, useEffect, useState } from "react";

import { getJson, postJson } from "../lib/api";
import { useAppConfig } from "../lib/useAppConfig";
import { notifyBillingChanged } from "../lib/useBillingStatus";

/**
 * The upgrade moment — two doors, no rent.
 *
 *   Fiat door:  pay what you want, ONCE. Not a subscription.
 *   Sovereign door: hold ITC on your account address — the same
 *   address you sign in with, fundable from Elara with the same
 *   twelve words. Hold the coin, never pay the fee.
 */

interface BillingStatus {
  limitEnabled: boolean;
  freeLimit: number;
  premiumProfileLimit: number;
  capExempt: boolean;
  owned: number;
  unlimited: boolean;
  via: string;
  itcThreshold: number;
  itcBalance: number | null;
  holderCheckAvailable: boolean;
  fiatDoor: boolean;
  pwywMinCents: number;
  address: string | null;
}

const PRESETS_CENTS = [500, 1000, 2500];

export function UpgradeCard({ onUnlocked }: { onUnlocked?: () => void }): React.ReactElement {
  const cfg = useAppConfig();
  const emailMode = cfg?.authMode === "email";
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [amount, setAmount] = useState<number>(1000);
  const [custom, setCustom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getJson<BillingStatus>("/api/billing/status");
      setStatus(s);
      notifyBillingChanged(); // the Nav badge (and anyone else) picks up fresh status too
      if (s.unlimited) onUnlocked?.();
    } catch {
      setError("could not load upgrade options");
    }
  }, [onUnlocked]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const cents = custom ? Math.round(Number(custom) * 100) : amount;
      const j = await postJson<{ url: string }>("/api/billing/checkout", {
        amountCents: cents,
        // Land back where the buyer was standing — an upgrade mid-edit
        // must never navigate someone away from their work (Marisa, 7/8).
        returnTo: window.location.pathname,
      });
      window.location.href = j.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "checkout failed");
      setBusy(false);
    }
  }, [amount, custom]);

  const copyAddress = useCallback(async () => {
    if (!status?.address) return;
    try {
      await navigator.clipboard.writeText(status.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* address is visible to copy manually */
    }
  }, [status]);

  if (!status) {
    return <p className="text-fg-subtle text-sm text-center py-8">loading…</p>;
  }

  return (
    <div className="panel p-6 sm:p-8 max-w-xl mx-auto animate-fade-in">
      <p className="font-mono text-xs uppercase tracking-widest text-accent-soft text-center">
        one profile free, forever
      </p>
      <h2 className="font-display text-2xl font-bold mt-2 text-center">
        {emailMode ? "Premium, once. Never monthly." : "Want more? Two doors, no rent."}
      </h2>
      <p className="text-fg-muted text-sm text-center mt-2">
        You have {status.owned} of {status.freeLimit} free profile
        {status.freeLimit === 1 ? "" : "s"}. Premium adds{" "}
        {status.premiumProfileLimit > 0
          ? `up to ${status.premiumProfileLimit} profiles`
          : "unlimited profiles"}{" "}
        + unlimited blocks — pay once, never monthly.
      </p>

      <div className={`mt-6 grid gap-3 ${emailMode ? "max-w-sm mx-auto" : "sm:grid-cols-2"}`}>
        {/* Fiat door */}
        <div className="border border-ink-700 rounded-xl p-4 flex flex-col">
          <p className="font-bold text-sm">Pay what you want</p>
          <p className="text-xs text-fg-subtle mt-1">
            Once. Not a subscription. Whatever it's worth to you.
          </p>
          {status.fiatDoor ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PRESETS_CENTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setAmount(c);
                      setCustom("");
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition ${
                      !custom && amount === c
                        ? "border-accent text-accent-soft bg-accent/10"
                        : "border-ink-700 text-fg-muted hover:border-accent/40"
                    }`}
                  >
                    ${c / 100}
                  </button>
                ))}
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="$…"
                  className="w-16 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent/60 placeholder:text-fg-faint"
                />
              </div>
              <button
                onClick={() => void checkout()}
                disabled={busy || (Boolean(custom) && Number(custom) * 100 < status.pwywMinCents)}
                className="mt-auto pt-3"
              >
                <span className="btn btn-primary w-full !py-2.5">
                  {busy ? "Opening checkout…" : "Unlock Premium"}
                </span>
              </button>
            </>
          ) : (
            <p className="mt-3 text-xs text-signal-amber font-mono">
              payments not configured on this instance
            </p>
          )}
        </div>

        {/* Sovereign door — wallet-mode only; ne-db.com never sees it */}
        {!emailMode && <div className="border border-accent/30 rounded-xl p-4 flex flex-col bg-accent/5">
          <p className="font-bold text-sm">
            Hold {status.itcThreshold}+ ITC <span className="text-accent">◆</span>
          </p>
          <p className="text-xs text-fg-subtle mt-1">
            On your account address — same twelve words open Elara. Hold the coin,
            never pay the fee.
          </p>
          {status.address && (
            <button
              onClick={() => void copyAddress()}
              title={status.address}
              className="mt-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-[11px] text-accent-soft text-left break-all hover:border-accent/50 transition"
            >
              {copied ? "✓ copied" : status.address}
            </button>
          )}
          <p className="mt-2 text-[11px] text-fg-subtle">
            {status.holderCheckAvailable
              ? status.itcBalance !== null
                ? `current balance: ${status.itcBalance.toLocaleString()} ITC`
                : ""
              : "balance check temporarily unavailable"}
          </p>
          <button
            onClick={() => void load()}
            className="mt-auto pt-3"
          >
            <span className="btn btn-accent-ghost w-full !py-2.5">
              Re-check balance
            </span>
          </button>
        </div>}
      </div>

      {error && <p className="mt-4 text-signal-red text-sm text-center font-mono">{error}</p>}
      <p className="mt-5 text-[11px] text-fg-subtle text-center">
        {emailMode
          ? "One-time payment. No subscription, ever."
          : `Self-hosting? Your own instance runs unlimited, free, GPLv3.`}
      </p>
    </div>
  );
}
