import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Check } from "lucide-react";

import { KundliHero } from "./KundliHero";
import {
  AIAndSmartLinks,
  CreatorCommerce,
  IndiaFirst,
  KundliAnalytics,
  KundliFAQ,
  KundliFinalCTA,
  KundliTemplates,
  LeadCapture,
  MoreThanALink,
  SocialProof,
  TheProblem,
} from "./KundliSections";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { Gate } from "./Gate";
import { UpgradeCard } from "./UpgradeCard";
import { useAppConfig } from "../lib/useAppConfig";
import { useClaimFlow } from "../lib/useClaimFlow";

/**
 * The iKundli storefront — Sukuna's India landing, re-authored as native
 * Portal components.
 *
 * Same codebase, same claim flow, same auth gates, same renderer: this
 * is a WIREFRAME, selected by LINKS_BRAND_KEY, not a fork. Everything
 * the visitor touches (availability, claim, upgrade) is the real
 * product — only the marketing surface changes.
 *
 * Design register: warm porcelain. The `kundli` app theme supplies the
 * tokens (near-white canvas, near-black ink, Instrument Serif display
 * over Outfit, marigold accent), so this file styles with the SAME
 * token classes every other page uses — no hard-coded palette, and the
 * theme switcher keeps working.
 *
 * Honest by construction: prices come from /api/config (the numbers the
 * gates actually enforce), and the model is pay-once — Mark's call,
 * 8/21, overriding the mock's monthly tiers. We do not print a
 * subscription we do not charge.
 */

// ── Section scaffolding ──────────────────────────────────────────────
function Section({
  id,
  kicker,
  title,
  lead,
  children,
  className = "",
}: {
  id?: string;
  kicker?: string;
  title?: React.ReactNode;
  lead?: string;
  children?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section id={id} className={`w-full max-w-5xl mx-auto px-5 py-16 sm:py-24 scroll-mt-24 ${className}`}>
      {kicker && <p className="kicker text-center">{kicker}</p>}
      {title && (
        <h2 className="font-display text-3xl sm:text-5xl text-center mt-3 leading-[1.05]">{title}</h2>
      )}
      {lead && (
        <p className="text-fg-muted text-center mt-4 max-w-2xl mx-auto text-base sm:text-lg leading-relaxed">
          {lead}
        </p>
      )}
      {children}
    </section>
  );
}

export function KundliLanding(): React.ReactElement {
  const cfg = useAppConfig();
  const brand = cfg?.brandName ?? "Kundli";
  const flow = useClaimFlow();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [host, setHost] = useState("kundli.in");

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  const money = useMemo(() => {
    const cur = cfg?.currency ?? "USD";
    const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : "";
    return { cur, sym };
  }, [cfg]);

  const freeBlocks = cfg?.freeBlockLimit ?? 3;
  const premiumProfiles = cfg?.premiumProfileLimit ?? 2;

  const badge: Record<string, React.ReactElement | null> = {
    idle: null,
    checking: <span className="text-fg-muted text-sm">checking…</span>,
    available: <span className="text-signal-green text-sm font-semibold">✓ available</span>,
    taken: <span className="text-signal-red text-sm font-semibold">taken</span>,
    invalid: <span className="text-signal-amber text-sm font-semibold">2–40 chars, a–z 0–9 -</span>,
  };

  const claimBox = (
    <section id="claim" className="w-full max-w-xl mx-auto panel p-6 sm:p-8 scroll-mt-24">
      {flow.claimed ? (
        <div className="text-center">
          <p className="kicker">your kundli is live</p>
          <h3 className="font-display text-3xl mt-2">
            {host}/{flow.claimed.handle}
          </h3>
          <p className="text-fg-muted text-sm mt-3">
            {flow.published
              ? "Published. Share it anywhere — the page, the card, the QR."
              : "Claimed. Publish it and every surface goes live at once."}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            {!flow.published && (
              <button
                onClick={() => void flow.publish()}
                disabled={flow.busy}
                className="btn btn-primary !py-3 col-span-2"
              >
                {flow.busy ? "Publishing…" : "Publish my Kundli"}
              </button>
            )}
            <a href={`/${flow.claimed.handle}`} className="btn btn-secondary !py-3">
              View page
            </a>
            <a href={`/edit/${encodeURIComponent(flow.claimed.identityId)}`} className="btn btn-secondary !py-3">
              Edit
            </a>
          </div>
        </div>
      ) : (
        <>
          <label className="label">Claim your handle</label>
          <div className="flex items-center gap-2 bg-ink-850 border border-ink-700 rounded-2xl px-4 py-3">
            <span className="font-mono text-sm text-fg-subtle shrink-0">{host}/</span>
            <input
              ref={inputRef}
              value={flow.handle}
              onChange={(e) => flow.setHandle(e.target.value)}
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-faint font-mono"
            />
            {badge[flow.availability]}
          </div>
          <label className="label mt-4">Display name</label>
          <input
            value={flow.displayName}
            onChange={(e) => flow.setDisplayName(e.target.value)}
            placeholder="Your name or brand"
            className="field"
          />
          <button
            onClick={() => void flow.claim()}
            disabled={flow.busy || flow.availability !== "available"}
            className="btn btn-primary w-full !py-3.5 !text-base mt-5"
          >
            {flow.busy ? "Claiming…" : "Create your Kundli"}
            <ArrowRight size={16} />
          </button>
          {flow.error && <p className="mt-3 text-signal-red text-sm text-center">{flow.error}</p>}
          <p className="text-[11px] text-fg-subtle text-center mt-4">
            Free forever · no card required · your handle is yours in 60 seconds
          </p>
        </>
      )}
    </section>
  );

  return (
    <>
      <Nav />
      <main>
        {/* ── Hero — Sukuna's rig, ported: canvas frame-sequence,
            floating chip convergence, phase labels, real CTA copy. ── */}
        <KundliHero />

        {/* ── The problem, the profile, India, commerce, playbook,
            analytics, AI, templates, social proof — all Sukuna's real
            sections, ported from his actual .tsx source (kundli.zip),
            not reinterpreted from the compiled dist. ─────────────── */}
        <TheProblem />
        <MoreThanALink />
        <IndiaFirst />
        <CreatorCommerce />
        <LeadCapture />
        <KundliAnalytics />
        <AIAndSmartLinks />
        <KundliTemplates />
        <SocialProof />

        {/* ── Pricing: PAY ONCE (Mark's call, 8/21) — his layout,
            our numbers. His source sells ₹119–499/mo; we don't. ──── */}
        <Section
          id="pricing"
          kicker="transparent pricing"
          title="Free is a full thing. Premium is forever."
          lead="Start completely free. Upgrade once when you want more — never a subscription, never monthly."
        >
          <div className="mt-10 grid md:grid-cols-2 gap-4 items-stretch max-w-3xl mx-auto">
            <div className="panel p-6">
              <p className="font-display text-2xl">Free, forever</p>
              <p className="text-sm text-fg-muted mt-1">No card. No trial clock.</p>
              <p className="font-display text-5xl mt-5">{money.sym}0</p>
              <ul className="mt-6 grid gap-2.5 text-sm">
                {[
                  "Your handle and your page",
                  `A full page — ${freeBlocks} blocks of any kind`,
                  "Every theme and background",
                  "Print-grade QR code",
                  "Save-my-contact for visitors",
                  "Live stats — views, scans, clicks",
                ].map((li) => (
                  <li key={li} className="flex items-start gap-2.5">
                    <Check size={15} className="text-signal-green shrink-0 mt-0.5" strokeWidth={3} />
                    <span className="text-fg-muted">{li}</span>
                  </li>
                ))}
              </ul>
              <a href="#claim" className="btn btn-secondary w-full !py-2.5 mt-6">
                Claim yours free
              </a>
            </div>
            <div className="panel p-6 !border-accent/40 relative">
              <span className="absolute top-4 right-4 chip !text-[10px] font-bold uppercase tracking-wider text-accent-soft">
                pay once
              </span>
              <p className="font-display text-2xl inline-flex items-center gap-2">
                <BadgeCheck size={18} className="text-accent-soft" /> Premium
              </p>
              <p className="text-sm text-fg-muted mt-1">
                Whatever it's worth to you, one time. <b className="text-fg">No subscription. Ever.</b>
              </p>
              <p className="font-display text-5xl mt-5">
                {money.sym}
                <span className="text-fg-muted text-2xl align-middle ml-1">you choose</span>
              </p>
              <ul className="mt-6 grid gap-2.5 text-sm">
                {[
                  "Everything in free",
                  `Up to ${premiumProfiles} profiles`,
                  "Unlimited blocks",
                  "Photo galleries & the QR studio",
                  "Custom search snippet & share card",
                  "Giveaways, Discover listing, the font vault",
                  "Team access — owners, editors, viewers",
                ].map((li) => (
                  <li key={li} className="flex items-start gap-2.5">
                    <Check size={15} className="text-accent-soft shrink-0 mt-0.5" strokeWidth={3} />
                    <span className="text-fg-muted">{li}</span>
                  </li>
                ))}
              </ul>
              <a href="#claim" className="btn btn-primary w-full !py-2.5 mt-6">
                Start free — upgrade when ready
              </a>
            </div>
          </div>
        </Section>

        {/* ── The claim ───────────────────────────────────────────── */}
        <Section
          kicker="digital identity mapped"
          title="Claim your handle."
          lead="One single link. Infinite possibilities. Get yours before someone else does."
        >
          <div className="mt-10">
            {flow.locked ? (
              <div className="w-full max-w-xl mx-auto">
                <Gate
                  onReady={() => {
                    flow.setLocked(false);
                    void flow.claim();
                  }}
                />
              </div>
            ) : flow.needsUpgrade ? (
              <div className="w-full max-w-xl mx-auto">
                <UpgradeCard onUnlocked={() => flow.setNeedsUpgrade(false)} />
              </div>
            ) : (
              claimBox
            )}
          </div>
        </Section>

        {/* ── FAQ ─────────────────────────────────────────────────── */}
        <KundliFAQ brand={brand} freeBlocks={freeBlocks} />

        {/* ── Closer — his real copy, wired to the real claim flow
            instead of a router mock to /register. ────────────────── */}
        <KundliFinalCTA
          brand={brand}
          handle={flow.handle}
          onHandleChange={flow.setHandle}
          onSubmit={() => {
            const el = document.getElementById("claim");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
            inputRef.current?.focus();
          }}
        />
      </main>
      <Footer />
    </>
  );
}
