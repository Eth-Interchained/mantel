import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Crown, Gift, Globe, Images, Infinity as InfinityIcon, QrCode, Search, Type, Users, X } from "lucide-react";

import { billingViaLabel, type BillingStatus } from "../lib/useBillingStatus";
import { useAppConfig } from "../lib/useAppConfig";

/**
 * The POST-premium states — the answer to "premium members shouldn't
 * feel static same-diff." Two moments, both portaled straight to
 * <body> (Nav carries backdrop-blur, which breaks position:fixed
 * containment for any descendant — see the upgrade-modal fix earlier
 * tonight; every modal in this file uses the same escape):
 *
 *   PremiumWelcomeModal — fires exactly once, right after a successful
 *     checkout lands back on /identities?upgraded=1. The payoff moment
 *     for someone who just paid real money deserves a real moment.
 *   PremiumStatusModal  — fires from the Nav badge, any time after.
 *     Not a paywall — a receipt. What you unlocked, and why you have it.
 */

const PERKS = [
  { icon: Images, label: "Photo galleries — show your work" },
  { icon: QrCode, label: "The QR studio — codes & flyers" },
  { icon: Gift, label: "Giveaways people trust" },
  { icon: Globe, label: "Custom SEO & the share card" },
  { icon: Search, label: "Listed in Discover" },
  { icon: Type, label: "The font vault — 38 typefaces" },
  { icon: InfinityIcon, label: "More profiles, unlimited blocks" },
  { icon: Users, label: "Team access — share your page" },
  { icon: Check, label: "Every premium unlock to come" },
];

function Shell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto modal-scroll bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="upgrade-ring w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative bg-ink-900 rounded-[18px] p-6 sm:p-8">
            <button onClick={onClose} className="icon-btn absolute top-3 right-3" aria-label="Close">
              <X size={16} />
            </button>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BrandCrown(): React.ReactElement {
  const cfg = useAppConfig();
  return cfg?.brandLogoUrl ? (
    <div className="relative mx-auto w-16 h-16">
      <img src={cfg.brandLogoUrl} alt="" className="w-16 h-16 object-contain" />
      <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-gradient-to-br from-[#00c2ff] to-[#b26cff] text-white inline-flex items-center justify-center shadow">
        <Crown size={12} fill="currentColor" />
      </span>
    </div>
  ) : (
    <Crown size={44} className="mx-auto text-accent" fill="currentColor" strokeWidth={1} />
  );
}

/** Fires once, right after a real checkout succeeds. The moment. */
export function PremiumWelcomeModal({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <Shell onClose={onClose}>
      <div className="text-center">
        <BrandCrown />
        <p className="kicker mt-3">premium unlocked</p>
        <h2 className="font-display text-2xl font-bold mt-1">Welcome to Premium 🎉</h2>
        <p className="text-fg-muted text-sm mt-2">
          That's it — Premium, once, never monthly. Here's what just turned on:
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {PERKS.map(({ icon: Icon, label }) => (
          <div key={label} className="rounded-xl bg-accent/10 border border-accent/30 px-3.5 py-3 flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-accent/15 text-accent-soft inline-flex items-center justify-center shrink-0">
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-tight">{label}</span>
            <Check size={15} className="text-signal-green shrink-0" strokeWidth={3} />
          </div>
        ))}
      </div>

      <button onClick={onClose} className="btn btn-primary w-full !py-3 mt-6">
        Let's go
      </button>
      <p className="mt-3 text-[11px] text-fg-subtle text-center">
        A receipt is on its way to your inbox. Thank you for backing the sovereign stack.
      </p>
    </Shell>
  );
}

/** The Nav badge's click target — a receipt, never a second paywall. */
export function PremiumStatusModal({
  status,
  onClose,
}: {
  status: BillingStatus;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Shell onClose={onClose}>
      <div className="text-center">
        <BrandCrown />
        <p className="kicker mt-3">your account</p>
        <h2 className="font-display text-2xl font-bold mt-1">You're Premium</h2>
        <p className="text-fg-muted text-sm mt-2">{billingViaLabel(status.via)}</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {PERKS.map(({ icon: Icon, label }) => (
          <div key={label} className="rounded-xl bg-ink-850 border border-ink-800 px-3.5 py-3 flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-accent/10 text-accent-soft inline-flex items-center justify-center shrink-0">
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-tight">{label}</span>
            <Check size={15} className="text-signal-green shrink-0" strokeWidth={3} />
          </div>
        ))}
      </div>

      {status.via === "holder" && status.itcBalance !== null && (
        <p className="mt-4 text-center text-xs text-fg-subtle font-mono">
          current balance: {status.itcBalance.toLocaleString()} ITC · threshold {status.itcThreshold}
        </p>
      )}

      <button onClick={onClose} className="btn btn-secondary w-full !py-2.5 mt-6">
        Close
      </button>
    </Shell>
  );
}
