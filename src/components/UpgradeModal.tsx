import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Gift, Globe, Images, Infinity as InfinityIcon, QrCode, Search, Sparkles, Type, Users, X } from "lucide-react";

import { useAppConfig } from "../lib/useAppConfig";
import { onUpgradeRequest, type UpgradeReason } from "../lib/upgrade";
import { UpgradeCard } from "./UpgradeCard";

/**
 * THE upgrade moment — one epic modal, summoned from every premium
 * wall in the product (giveaways, Discover, the font vault, profile
 * limits) and from the ✨ chip in the nav. The shell is the show:
 * holographic ring, brand mark, the four unlocks. The engine inside is
 * the same battle-tested UpgradeCard — one checkout path, everywhere.
 */

const HEADLINES: Record<UpgradeReason, [string, string]> = {
  giveaway: ["Giveaways are a premium unlock", "Host giveaways people can trust and harvest verified leads."],
  discover: ["Get found in Discover", "Premium pages can list themselves in the public directory."],
  font: ["Unlock the font vault", "Thirty-five more typefaces — display, serif, mono, script."],
  blocks: ["Your page wants more blocks", "Free pages hold three — premium builds without block limits."],
  gallery: ["Show your work", "Photo galleries are a premium unlock — your page becomes a portfolio."],
  qr: ["Own the counter", "Brand colors, per-link codes, and print flyers — the QR studio is premium."],
  seo: ["Own your snippet", "Custom search titles, descriptions, and share cards are premium."],
  access: ["Invite your team", "Shared access — owners, editors, viewers, with provenance — is premium."],
  limit: ["You've used your free profile", "Premium adds more profiles — pay once, never monthly."],
  generic: ["Go Premium", "Everything the free tier holds back, unlocked at once."],
};

const PERKS = [
  { icon: Images, label: "Photo galleries", sub: "show your work, swipeable" },
  { icon: QrCode, label: "The QR studio", sub: "brand colors, per-link codes, flyers" },
  { icon: Gift, label: "Giveaways people trust", sub: "lead generation with receipts" },
  { icon: Globe, label: "Own your snippet", sub: "custom SEO + the share card" },
  { icon: Search, label: "Listed in Discover", sub: "be found, on purpose" },
  { icon: Type, label: "The font vault", sub: "38 curated typefaces" },
  { icon: InfinityIcon, label: "More profiles, unlimited blocks", sub: "build without block ceilings" },
  { icon: Users, label: "Share access with your team", sub: "owners, editors, viewers" },
  { icon: Sparkles, label: "Everything that lands next", sub: "premium once means premium always" },
];

export function UpgradeModal(): React.ReactElement | null {
  const cfg = useAppConfig();
  const [reason, setReason] = useState<UpgradeReason | null>(null);

  useEffect(() => onUpgradeRequest((r) => setReason(r)), []);

  // Escape closes — the modal is an invitation, never a trap.
  useEffect(() => {
    if (!reason) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReason(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reason]);

  if (!reason) return null;
  const [title, sub] = HEADLINES[reason];

  const modal = (
    // The OUTER element is the scroll container (not the ring). This is
    // the robust modal pattern: a flex row taller than the viewport
    // simply grows the scrollable content, so overflow is reachable
    // symmetrically top AND bottom. Centering a shorter-than-viewport
    // panel with pure flex (no inner scroll) clips unreachable content
    // above y:0 the moment it overflows — this avoids that trap.
    <div
      className="fixed inset-0 z-50 overflow-y-auto modal-scroll bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => setReason(null)}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="upgrade-ring w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="relative bg-ink-900 rounded-[18px] p-6 sm:p-8">
            <button
              onClick={() => setReason(null)}
              className="icon-btn absolute top-3 right-3"
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="text-center">
              {cfg?.brandLogoUrl ? (
                <img src={cfg.brandLogoUrl} alt="" className="h-14 w-14 mx-auto object-contain" />
              ) : (
                <span className="text-4xl text-accent">⬡</span>
              )}
              <p className="kicker mt-3">premium</p>
              <h2 className="font-display text-2xl font-bold mt-1">{title}</h2>
              <p className="text-fg-muted text-sm mt-2">{sub}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              {PERKS.map(({ icon: Icon, label, sub: perkSub }) => (
                <div key={label} className="rounded-xl bg-ink-850 border border-ink-800 px-3.5 py-3 flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-accent/10 text-accent-soft inline-flex items-center justify-center shrink-0">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold leading-tight">{label}</span>
                    <span className="block text-[10.5px] text-fg-subtle mt-0.5">{perkSub}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <UpgradeCard onUnlocked={() => setReason(null)} />
            </div>

            <button
              onClick={() => setReason(null)}
              className="block mx-auto mt-4 text-xs font-medium text-fg-subtle hover:text-fg transition"
            >
              maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // A portal straight to <body> — escaping Nav's own box entirely. Nav
  // carries backdrop-blur, and per spec, filter/backdrop-filter on an
  // ancestor establishes a new containing block for position:fixed
  // descendants. Rendered as Nav's child, this modal was "fixed"
  // relative to the ~56px nav strip, not the viewport — which is
  // exactly why it rendered pinned near the top with stray scrollbars
  // instead of centered on screen. The portal makes containment a
  // non-issue: this DOM node is a body-level sibling, so fixed means
  // fixed-to-viewport again, no matter what any ancestor does with CSS.
  return createPortal(modal, document.body);
}
