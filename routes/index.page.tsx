import React, { useCallback, useMemo, useState } from "react";
import { BarChart3, Check, Contact, Crown, Gift, Link2, Palette, QrCode, ShieldCheck, Sparkles } from "lucide-react";

import "../src/lib/blocks/builtin";
import "../src/lib/templates/builtin";
import { KundliLanding } from "../src/components/KundliLanding";
import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { Gate } from "../src/components/Gate";
import { UpgradeCard } from "../src/components/UpgradeCard";
import { useClaimFlow, type Availability } from "../src/lib/useClaimFlow";
import { useAppConfig } from "../src/lib/useAppConfig";
import { type Block } from "../src/lib/identity";
import { listTemplates } from "../src/lib/registry";
import { THEMES } from "../src/lib/renderers/html";

export const intent = {
  purpose:
    "Claim-first onboarding: type a handle, see availability instantly, seed from a template, publish, share",
  primaryAction: "Claim a handle",
  seoKeyword: "link in bio identity platform",
};


/**
 * The template gallery — show, don't quiz. Each card is a miniature of
 * what the template ACTUALLY seeds: its blocks, in its theme's colors.
 * Nothing here gates the claim — a starting point is pre-picked and
 * everything is editable after.
 */
function TemplateMini({
  blocks,
  theme,
}: {
  blocks: Block[];
  theme: string;
}): React.ReactElement {
  const t = THEMES[theme] ?? THEMES.pro;
  return (
    <div
      className="h-16 rounded-t-[inherit] px-3 py-2 flex flex-col gap-1 overflow-hidden"
      style={{ background: t.bg }}
    >
      {blocks.slice(0, 4).map((b) => {
        if (b.type === "header") {
          return (
            <div
              key={b.id}
              className="h-1 w-8 rounded-full shrink-0"
              style={{ background: t.sub, opacity: 0.8 }}
            />
          );
        }
        if (b.type === "social") {
          return (
            <div key={b.id} className="flex gap-1 shrink-0">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: t.accent, opacity: 0.85 }}
                />
              ))}
            </div>
          );
        }
        if (b.type === "text") {
          return (
            <div
              key={b.id}
              className="h-1 w-full rounded-full shrink-0"
              style={{ background: t.sub, opacity: 0.4 }}
            />
          );
        }
        // link / embed — the tappable bar with its accent dot
        return (
          <div
            key={b.id}
            className="h-2.5 w-full rounded-[4px] flex items-center gap-1 px-1 shrink-0"
            style={{ background: t.card }}
          >
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: t.accent }} />
            <span className="h-0.5 flex-1 rounded-full" style={{ background: t.text, opacity: 0.5 }} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The publish moment: every output of the loop in one place.
 * Share URL, print-grade QR (SVG + PNG), save-contact vCard, business
 * card, and the JSON surface — each one is a registered renderer over
 * the same Identity Manifest.
 */
function ShareKit({
  handle,
  identityId,
}: {
  handle: string;
  identityId: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const url = `${origin}/${handle}`;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the URL is visible to select manually */
    }
  }, [url]);

  return (
    <div className="text-left">
      <p className="text-fg-muted mt-3 text-center">
        Live. One identity, every surface:
      </p>

      <div className="mt-5 flex items-center gap-2 bg-ink-850 border border-ink-700 rounded-xl px-4 py-3">
        <span className="flex-1 font-mono text-sm text-accent-soft truncate">{url}</span>
        <button
          onClick={copy}
          className="shrink-0 rounded-lg border border-accent/50 text-accent-soft text-xs font-bold px-3 py-1.5 hover:bg-accent/10 transition"
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-4 items-center bg-ink-850 border border-ink-700 rounded-xl p-4">
        <img
          src={`/${handle}?format=qr`}
          alt={`QR code for ${handle}`}
          className="w-24 h-24 rounded-lg bg-white p-1"
        />
        <div>
          <p className="text-sm font-semibold text-fg">
            Print-grade QR — scans are tracked separately from taps.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={`/${handle}?format=qr&download=1`}
              className="rounded-lg border border-ink-700 text-fg-muted text-xs font-bold px-3 py-1.5 hover:border-accent/50 hover:text-accent-soft transition"
            >
              ↓ SVG
            </a>
            <a
              href={`/${handle}?format=qr&type=png&download=1`}
              className="rounded-lg border border-ink-700 text-fg-muted text-xs font-bold px-3 py-1.5 hover:border-accent/50 hover:text-accent-soft transition"
            >
              ↓ PNG (1024px)
            </a>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={`/${handle}`} className="btn btn-primary !py-3">
          View profile
        </a>
        <a href={`/${handle}?format=card`} className="btn btn-accent-ghost !py-3">
          Business card
        </a>
        <a href={`/${handle}?format=vcard`} className="btn btn-secondary !py-3">
          Save contact (.vcf)
        </a>
        <a href={`/${handle}?format=json`} className="btn btn-secondary !py-3">
          JSON surface
        </a>
      </div>

      <a
        href={`/edit/${encodeURIComponent(identityId)}`}
        className="btn btn-secondary mt-3 w-full !py-3"
      >
        ✎ Edit page
      </a>

      <p className="mt-4 text-xs text-fg-subtle text-center">
        Every surface above is a renderer over the same Identity Manifest.
      </p>
    </div>
  );
}

export default function ClaimPage(): React.ReactElement {
  const cfg = useAppConfig();
  const emailMode = cfg?.authMode === "email";
  // Storefronts are WIREFRAMES, selected by env — not forks. iKundli
  // (India) sells with its own landing; the product underneath is
  // byte-identical. Config arrives async, so hold the default until it
  // lands rather than flashing the wrong storefront.
  const kundli = cfg?.brandKey === "kundli";
  // Seed each template once for its gallery card — the mini previews
  // show the REAL scaffold (blocks + theme), not a label.
  const templates = useMemo(
    () =>
      listTemplates().map((t) => {
        const seeded = t.seed({ displayName: "You", handle: "you" });
        return { ...t, previewBlocks: seeded.blocks, previewTheme: seeded.theme ?? "pro" };
      }),
    [],
  );
  // The claim flow lives in a shared hook — the iKundli storefront runs
  // the exact same implementation, so a fix here fixes every brand.
  const {
    handle,
    setHandle,
    availability,
    displayName,
    setDisplayName,
    template,
    setTemplate,
    busy,
    error,
    locked,
    setLocked,
    needsUpgrade,
    setNeedsUpgrade,
    claimed,
    published,
    claim,
    publish,
  } = useClaimFlow();

  const badge: Record<Availability, React.ReactElement | null> = {
    idle: null,
    checking: <span className="text-fg-muted text-sm">checking…</span>,
    available: <span className="text-signal-green text-sm font-semibold">✓ available</span>,
    taken: <span className="text-signal-red text-sm font-semibold">taken</span>,
    invalid: <span className="text-signal-amber text-sm font-semibold">2–40 chars, a–z 0–9 -</span>,
  };

  // iKundli sells with its own wireframe. Placed after every hook so
  // the rules of hooks hold; config arrives async, so the default
  // storefront only renders once we know which brand we are.
  if (kundli) return <KundliLanding />;

  return (
    <>
    <Nav />
    <main className="min-h-screen flex flex-col items-center px-5 py-16">
      <header className="text-center max-w-2xl animate-slide-up">
        {cfg?.brandLogoUrl && (
          <img
            src={cfg.brandLogoUrl}
            alt=""
            className="h-20 w-20 mx-auto mb-5 object-contain drop-shadow-[0_0_24px_rgba(99,102,241,0.45)]"
          />
        )}
        <p className="font-mono text-xs tracking-widest text-accent-soft uppercase">
          NEDB stores knowledge · Portal renders experiences · Links publishes identity
        </p>
        <h1 className="chrome-text font-display text-4xl sm:text-6xl font-bold mt-4 leading-tight">
          One handle.
          <br />
          <span className="text-accent">Every surface.</span>
        </h1>
        <p className="text-fg-muted mt-4 text-lg">
          {emailMode
            ? "Your professional identity, actually yours. Claim your handle and publish everywhere — profile page, business card, QR code, vCard."
            : "Your professional identity, owned like a wallet. Claim your handle and publish everywhere — profile page, business card, QR code, vCard."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-[11px] font-mono uppercase tracking-wider">
          <span className="chip bg-ink-900 text-fg-subtle">{emailMode ? "free forever" : "no email required"}</span>
          <span className="chip bg-ink-900 text-fg-subtle">every edit versioned</span>
          <span className="chip bg-ink-900 text-fg-subtle">tamper-evident</span>
          <span className="chip bg-ink-900 text-fg-subtle">{emailMode ? "premium, pay once" : "yours to self-host"}</span>
        </div>
        {/* Discover leads; claiming is the working section right below.
            Server route — hard link, not SPA. */}
        <a href="/discover" className="btn btn-primary !py-3 !px-7 !text-base mt-7 inline-flex">
          Discover people →
        </a>
      </header>

      {locked ? (
        <div className="w-full max-w-xl">
          <Gate
            onReady={() => {
              setLocked(false);
              // Continue the claim the user already started — no second click.
              void claim();
            }}
          />
        </div>
      ) : needsUpgrade ? (
        <div className="w-full max-w-xl mt-12">
          <UpgradeCard onUnlocked={() => setNeedsUpgrade(false)} />
        </div>
      ) : (
      <section id="claim" className="w-full max-w-xl mt-12 panel p-6 sm:p-8 shadow-glow animate-fade-in scroll-mt-20">
        {!claimed ? (
          <>
            <label className="label">Claim your handle</label>
            <div className="field field-lg flex items-center gap-2 focus-within:!border-accent">
              <span className="text-fg-subtle font-mono">links/</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="mintontheavenue"
                autoFocus
                className="flex-1 bg-transparent outline-none font-mono text-lg text-fg placeholder:text-fg-faint min-w-0"
              />
              {badge[availability]}
            </div>

            <label className="label mt-6">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Marisa Yvette"
              className="field field-lg"
            />

            <div className="mt-6 flex items-baseline justify-between gap-3">
              <label className="label !mb-0">Starting point</label>
              <span className="text-[11px] text-fg-subtle">
                optional — seeds example blocks &amp; a look, change anything later
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {templates.map((t) => {
                const selected = template === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTemplate(t.id)}
                    title={t.description}
                    className={`panel panel-lift overflow-hidden text-left !rounded-xl ${
                      selected ? "ring-2 ring-accent border-accent/40" : ""
                    }`}
                  >
                    <TemplateMini blocks={t.previewBlocks} theme={t.previewTheme} />
                    <span className="block px-2.5 py-1.5">
                      <span className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold truncate">{t.name}</span>
                        {selected && <span className="text-accent-soft text-xs shrink-0">✓</span>}
                      </span>
                      <span className="block text-[10px] text-fg-subtle leading-tight truncate">
                        {t.vertical}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={claim}
              disabled={busy || availability !== "available"}
              className="btn btn-primary mt-8 w-full !py-3.5 !text-lg"
            >
              {busy ? "Claiming…" : "Claim it"}
            </button>
          </>
        ) : (
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-green">
              claimed
            </p>
            <h2 className="font-display text-3xl font-bold mt-2">@{claimed.handle}</h2>
            {!published ? (
              <>
                <p className="text-fg-muted mt-3">
                  Your draft is ready — the template seeded your page. Fill in your
                  links, then publish to go live.
                </p>
                <a
                  href={`/edit/${encodeURIComponent(claimed.identityId)}`}
                  className="btn btn-primary mt-6 w-full !py-3.5 !text-lg"
                >
                  Edit your draft →
                </a>
                <button
                  onClick={publish}
                  disabled={busy}
                  className="btn btn-accent-ghost mt-3 w-full !py-3"
                >
                  {busy ? "Publishing…" : "Publish as-is"}
                </button>
              </>
            ) : (
              <ShareKit handle={claimed.handle} identityId={claimed.identityId} />
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 text-signal-red text-sm text-center font-mono">{error}</p>
        )}
      </section>
      )}

      {/* ── The sell — Marisa's clients land here not knowing what a
          "claim" even is. Below the fold answers it: what this is, how
          it works, what you get, why to trust it. Short lines; the
          product does the talking. ── */}
      <section className="w-full max-w-4xl mt-24">
        <p className="kicker text-center">what is this?</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mt-2">
          One link that holds all your links.
        </h2>
        <p className="text-fg-muted text-center mt-3 max-w-xl mx-auto">
          Your page at <span className="font-mono text-accent-soft">{typeof window !== "undefined" ? window.location.host : "ourlynx.com"}/you</span> —
          everything you do, one tap away, ready for your bio, your counter, and your business card.
        </p>

        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          {[
            { n: "1", title: "Claim your name", copy: "Pick your handle — it's yours in under a minute." },
            { n: "2", title: "Make it yours", copy: "Start from a template, drop in your links, choose your look." },
            { n: "3", title: "Share one link", copy: "Bio, QR sticker, business card — every surface from one page." },
          ].map((s2) => (
            <div key={s2.n} className="panel p-5 text-center">
              <span className="w-9 h-9 rounded-full bg-accent/10 text-accent-soft font-display font-bold inline-flex items-center justify-center">
                {s2.n}
              </span>
              <p className="font-semibold mt-3">{s2.title}</p>
              <p className="text-sm text-fg-muted mt-1.5">{s2.copy}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── What done looks like — the REAL renderer in a phone frame,
          not a mockup. Mark's call: sell the destination. ── */}
      <section className="w-full max-w-4xl mt-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div className="text-center md:text-left">
            <p className="kicker">see one finished</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold mt-2">
              This is what done looks like.
            </h2>
            <p className="text-fg-muted mt-3">
              A real page, rendered live by the exact engine yours will use —
              booking links, save-my-contact, QR, the whole thing. Not a
              mockup, not a screenshot.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 justify-center md:justify-start">
              <a href="#claim" className="btn btn-primary">Start yours</a>
              <a
                href="/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Open the demo full-size ↗
              </a>
            </div>
          </div>
          <div className="mx-auto">
            <div className="phone-frame">
              <iframe src="/demo" title="A finished page, live" loading="lazy" className="demo-iframe" />
            </div>
          </div>
        </div>
      </section>

      <section className="w-full max-w-4xl mt-20">
        <p className="kicker text-center">what you get</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mt-2">
          More than a link page.
        </h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { Icon: Link2, title: "Every link, one page", copy: "Instagram, booking, menu, music — all behind one link you'll never have to change." },
            { Icon: QrCode, title: "Print-grade QR", copy: "Stick it on the counter or the mirror. Scans are counted separately from taps." },
            { Icon: Contact, title: "Save my contact", copy: "Visitors add you to their phone in one tap — name, links, and all." },
            { Icon: Gift, title: "Giveaways people trust", copy: "Run a giveaway anyone can check was honest — every draw on the record." },
            { Icon: BarChart3, title: "Know what works", copy: "Live views, scans, and clicks — see where people found you." },
            { Icon: Palette, title: "Your look", copy: "Themes, gradient backgrounds, and a vault of fonts. Your page, your taste." },
          ].map(({ Icon, title, copy }) => (
            <div key={title} className="panel p-5">
              <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent-soft inline-flex items-center justify-center">
                <Icon size={17} />
              </span>
              <p className="font-semibold mt-3">{title}</p>
              <p className="text-sm text-fg-muted mt-1.5">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The deal — free vs premium with the SAME numbers the gates
          enforce (from /api/config). Mark's call: sell what they GET. ── */}
      <section className="w-full max-w-4xl mt-20">
        <p className="kicker text-center">the deal</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mt-2">
          Free is a full thing. Premium is forever.
        </h2>
        <div className="mt-10 grid md:grid-cols-2 gap-4 items-stretch">
          <div className="panel p-6">
            <p className="font-display font-bold text-lg">Free, forever</p>
            <p className="text-sm text-fg-muted mt-1">No card. No trial clock. A complete page, not a teaser.</p>
            <ul className="mt-5 grid gap-2.5 text-sm">
              {[
                "Your handle and your page",
                `A full page — ${cfg?.freeBlockLimit ?? 3} blocks of any kind`,
                "Every theme and gradient background",
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
            <a href="#claim" className="btn btn-secondary w-full !py-2.5 mt-6">Claim yours free</a>
          </div>
          <div className="panel p-6 !border-accent/40 relative overflow-hidden">
            <span className="absolute top-4 right-4 chip text-[10px] font-bold uppercase tracking-wider text-accent-soft">pay once</span>
            <p className="font-display font-bold text-lg inline-flex items-center gap-2">
              <Crown size={16} className="text-accent-soft" /> Premium
            </p>
            <p className="text-sm text-fg-muted mt-1">
              Whatever it's worth to you, one time. <b className="text-fg">No subscription. Ever.</b>
            </p>
            <ul className="mt-5 grid gap-2.5 text-sm">
              {[
                "Everything in free",
                `${cfg?.premiumProfileLimit && cfg.premiumProfileLimit > 0 ? `Up to ${cfg.premiumProfileLimit} profiles` : "More profiles"} — business, personal, next thing`,
                "Unlimited blocks — build without ceilings",
                "Photo galleries — show your work, swipeable",
                "The QR studio — brand colors, per-link codes, flyers",
                "Custom search snippet & share card",
                "Team access — owners, editors, viewers",
                "Giveaways anyone can check were honest",
                "Listed in Discover — be found on purpose",
                "The font vault — 38 curated typefaces",
              ].map((li) => (
                <li key={li} className="flex items-start gap-2.5">
                  <Check size={15} className="text-accent-soft shrink-0 mt-0.5" strokeWidth={3} />
                  <span className="text-fg-muted">{li}</span>
                </li>
              ))}
            </ul>
            <a href="#claim" className="btn btn-primary w-full !py-2.5 mt-6">Start free — upgrade when ready</a>
            {!emailMode && (
              <p className="mt-3 text-[11px] text-fg-subtle text-center">
                Or hold ITC on your account — the sovereign door. Self-hosting? Your instance runs uncapped, GPLv3.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="w-full max-w-4xl mt-20">
        <div className="panel p-6 sm:p-8 grid sm:grid-cols-3 gap-6 text-center">
          <div>
            <Sparkles size={18} className="mx-auto text-accent-soft" />
            <p className="font-semibold mt-2 text-sm">Free forever</p>
            <p className="text-xs text-fg-muted mt-1">One page, no card required.</p>
          </div>
          <div>
            <ShieldCheck size={18} className="mx-auto text-accent-soft" />
            <p className="font-semibold mt-2 text-sm">On the record</p>
            <p className="text-xs text-fg-muted mt-1">Every edit is versioned and tamper-evident — your page can't be quietly changed.</p>
          </div>
          <div>
            <Gift size={18} className="mx-auto text-accent-soft" />
            <p className="font-semibold mt-2 text-sm">Premium, once</p>
            <p className="text-xs text-fg-muted mt-1">Unlock everything with one payment. Never monthly.</p>
          </div>
        </div>
      </section>

      <section className="w-full max-w-4xl mt-20 text-center">
        <h2 className="font-display text-3xl sm:text-4xl font-bold">
          Your name is waiting.
        </h2>
        <p className="text-fg-muted mt-3">Claiming takes under a minute — and the first page is free, forever.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="#claim" className="btn btn-primary !py-3 !px-8 !text-base">Claim your handle</a>
          <a href="/discover" className="btn btn-secondary !py-3 !px-6">See who's here →</a>
        </div>
      </section>

      <footer className="mt-16 text-center text-fg-subtle text-sm max-w-xl">
        {emailMode ? (
          <p className="font-semibold text-fg-muted">
            Everything here is yours — no subscription, nothing locked away.
          </p>
        ) : (
          <p className="font-semibold text-fg-muted">
            Open by design — every block, theme, and renderer is public API. GPLv3, self-hostable.
          </p>
        )}
      </footer>
    </main>
    <Footer />
    </>
  );
}
