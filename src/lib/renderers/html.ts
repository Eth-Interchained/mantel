/**
 * HTML profile renderer — registry citizen number one.
 *
 * Server-rendered, mobile-first, zero client JavaScript for viewers.
 * A visitor's phone gets one small HTML document; the React app is for
 * editing, never for viewing.
 */

import { anchorOf, bgCss, pageInkOn, type BackgroundConfig } from "../background";
import { conicStops, giveawayStops } from "../giveawayTheme";
import { FONTS, isFilledUrl, type Block, type IdentityManifest } from "../identity";
import { defineRenderer, type RenderContext } from "../registry";
import { SOC_PREFIX, brandGlyph, socialGlyph } from "./social-icons";

export interface ThemePalette {
  /** Page background — a color OR a CSS gradient string. */
  bg: string;
  card: string;
  text: string;
  sub: string;
  accent: string;
  /** Solid anchor for color-only positions (borders, text color) when
   *  bg is a gradient. Renderers use solidBg(t), never t.bg, there. */
  base?: string;
  /** Ink for text sitting DIRECTLY on the page background (name, bio,
   *  headers, footer). Set by background overrides so page text stays
   *  readable over any canvas; cards keep text/sub. Absent = text/sub. */
  pageText?: string;
  pageSub?: string;
}

/** The solid stand-in for gradient backgrounds. */
export function solidBg(t: ThemePalette): string {
  return t.base ?? t.bg;
}

/** Ink for content on the page canvas (vs. inside cards). */
export function pageText(t: ThemePalette): string {
  return t.pageText ?? t.text;
}
export function pageSub(t: ThemePalette): string {
  return t.pageSub ?? t.sub;
}

/**
 * Compose a manifest-level background over a theme: the canvas (and its
 * solid anchor + page ink) comes from the background; cards, accents,
 * and card text stay with the theme. This is why Midnight-behind-Signal
 * and Forest-behind-Mach both just work.
 */
export function applyBackground(t: ThemePalette, bg?: BackgroundConfig): ThemePalette {
  if (!bg) return t;
  const anchor = anchorOf(bg);
  const ink = pageInkOn(anchor);
  return { ...t, bg: bgCss(bg), base: anchor, pageText: ink.text, pageSub: ink.sub };
}

export const THEMES: Record<string, ThemePalette> = {
  pro:      { bg: "#f3f6f8", card: "#ffffffee", text: "#0f172a", sub: "#475569", accent: "#0e7490" },
  signal:   { bg: "#0f172a", card: "#1e293bcc", text: "#f8fafc", sub: "#94a3b8", accent: "#60a5fa" },
  mach:     { bg: "#0b0d11", card: "#161a2299", text: "#f4f6f9", sub: "#9aa7b8", accent: "#cbd5e1" },
  midnight: { bg: "#070a12", card: "#11162299", text: "#f8fafc", sub: "#94a3b8", accent: "#22d3ee" },
  terminal: { bg: "#05080a", card: "#0c141066", text: "#e2f9ee", sub: "#6ee7b7", accent: "#34d399" },
  violet:   { bg: "#0b0714", card: "#1a112999", text: "#f5f3ff", sub: "#a78bfa", accent: "#8b5cf6" },
  ember:    { bg: "#120806", card: "#22110d99", text: "#fff7ed", sub: "#fdba74", accent: "#f97316" },
  rosegold: { bg: "#140a0d", card: "#24121899", text: "#fff1f2", sub: "#fda4af", accent: "#fb7185" },
  forest:   { bg: "#06110b", card: "#0d1f1599", text: "#f0fdf4", sub: "#86efac", accent: "#22c55e" },
  daylight: { bg: "#f8fafc", card: "#ffffffcc", text: "#0f172a", sub: "#475569", accent: "#0284c7" },
  /* iKundli's porcelain — the public page wears the landing's identity. */
  kundli:   { bg: "#fefefe", card: "#faf6f2", text: "#110e0c", sub: "#5a4e46", accent: "#c85c10" },
  mono:     { bg: "#0a0a0a", card: "#16161699", text: "#fafafa", sub: "#a3a3a3", accent: "#e5e5e5" },
  slate:    { bg: "#0b1017", card: "#151d2999", text: "#f1f5f9", sub: "#94a3b8", accent: "#38bdf8" },
  // ── The gradient tier — flagship strength, still one HTML file, zero JS ──
  aurora:   { bg: "linear-gradient(165deg,#0b1026 0%,#1e1b4b 45%,#172554 100%)", base: "#141a3a",
              card: "#1e1b4b99", text: "#eef2ff", sub: "#a5b4fc", accent: "#818cf8" },
  sunset:   { bg: "linear-gradient(160deg,#2a1445 0%,#7c2d5c 55%,#b4530a 100%)", base: "#3b1d4f",
              card: "#3b1d4f99", text: "#fff7ed", sub: "#fdba74", accent: "#fb923c" },
  ocean:    { bg: "linear-gradient(170deg,#031c26 0%,#0c4a6e 60%,#043c50 100%)", base: "#062a38",
              card: "#0c4a6e80", text: "#ecfeff", sub: "#67e8f9", accent: "#22d3ee" },
  noir:     { bg: "radial-gradient(130% 130% at 50% 0%,#26262b 0%,#0a0a0c 60%)", base: "#111114",
              card: "#1c1c2166", text: "#fafafa", sub: "#a1a1aa", accent: "#e4e4e7" },
  blossom:  { bg: "linear-gradient(160deg,#fdf2f8 0%,#ede9fe 60%,#fce7f3 100%)", base: "#fdf2f8",
              card: "#ffffffd9", text: "#500724", sub: "#9d174d", accent: "#db2777" },
  citrus:   { bg: "linear-gradient(160deg,#f7fee7 0%,#ecfccb 45%,#d9f99d 100%)", base: "#f7fee7",
              card: "#ffffffcc", text: "#1a2e05", sub: "#4d7c0f", accent: "#65a30d" },
};

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeUrl(u: unknown): string {
  const s = String(u ?? "");
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  return "#";
}

/** Brand asset URLs: absolute https OR same-origin root-relative
 *  (/assets/…). Protocol-relative (//host) and schemes are refused —
 *  an env typo must never inject a foreign origin or a script URL. */
export function assetUrl(u: unknown): string {
  const s = String(u ?? "");
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return "";
}

/** Google Fonts link for the manifest's curated picks — built from the
 *  FONTS map only (user input is an enum id, never a string). */
export function fontAssets(m: IdentityManifest): {
  link: string;
  headingCss: string;
  bodyCss: string;
} {
  const heading = FONTS[m.themeCustom?.headingFont ?? "system"];
  const body = FONTS[m.themeCustom?.bodyFont ?? "system"];
  const families = [...new Set([heading.google, body.google].filter(Boolean))] as string[];
  const link = families.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com" />\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n<link href="https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap" rel="stylesheet" />`
    : "";
  return { link, headingCss: heading.css, bodyCss: body.css };
}

/** Click-tracked outbound URL: /go/:identityId/:blockId?to=... */
function go(origin: string, m: IdentityManifest, blockId: string, url: string): string {
  return `${origin}/go/${encodeURIComponent(m.identityId)}/${encodeURIComponent(blockId)}?to=${encodeURIComponent(url)}`;
}

/** A block icon is either a text glyph (escaped) or a `soc:<brand>`
 *  token → inline brand SVG. Unknown tokens render NOTHING — the raw
 *  token string never leaks onto a public page. */
function iconMarkup(icon: unknown): string {
  const s = String(icon ?? "");
  if (!s) return "";
  if (s.startsWith(SOC_PREFIX)) {
    const path = brandGlyph(s.slice(SOC_PREFIX.length));
    return path ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>` : "";
  }
  return esc(s);
}

/**
 * Build a wa.me link from validated parts.
 *
 * The phone is re-checked here (digits only) even though the schema
 * already enforces it — a renderer must never trust that the data it was
 * handed came through the current schema. Old documents outlive schemas.
 */
export function whatsappHref(phone: unknown, message: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  const msg = String(message ?? "").trim().slice(0, 300);
  return `https://wa.me/${digits}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
}

/**
 * Build a UPI intent from validated parts — payer straight to payee.
 *
 * Every component is re-validated and URI-encoded here; nothing the user
 * typed reaches the href as raw text. Returns null unless the VPA is
 * well-formed, so a half-filled block renders as nothing rather than as
 * a broken payment link (a wrong payee address is worse than no button).
 */
export function upiHref(d: Record<string, unknown>): string | null {
  const vpa = String(d.vpa ?? "").trim();
  if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/.test(vpa)) return null;
  const params = [`pa=${encodeURIComponent(vpa)}`];
  const payee = String(d.payeeName ?? "").trim().slice(0, 60);
  if (payee) params.push(`pn=${encodeURIComponent(payee)}`);
  const amt = typeof d.amount === "number" ? d.amount : Number(d.amount);
  if (Number.isFinite(amt) && amt > 0) params.push(`am=${amt.toFixed(2)}`);
  params.push("cu=INR");
  const note = String(d.note ?? "").trim().slice(0, 80);
  if (note) params.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${params.join("&")}`;
}

/**
 * The UPI intent for a PRODUCT block.
 *
 * Products name their money field `price` (a product has a price; a
 * payment has an amount), so this maps the product's shape onto the
 * intent builder rather than letting the two drift. Found the hard way:
 * calling upiHref() directly on a product silently produced a link with
 * no `am=`, which opens the payer's app with a blank amount and quietly
 * pushes the seller's price onto the buyer to retype.
 */
export function productUpiHref(d: Record<string, unknown>): string | null {
  const price = typeof d.price === "number" ? d.price : Number(d.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return upiHref({
    vpa: d.vpa,
    payeeName: d.payeeName,
    amount: price,
    note: d.note ?? d.title,
  });
}

function embedFrame(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const sp = url.match(/open\.spotify\.com\/(track|album|playlist|artist)\/(\w+)/);
  if (sp) return `https://open.spotify.com/embed/${sp[1]}/${sp[2]}`;
  return null;
}

function renderBlock(b: Block, m: IdentityManifest, origin: string): string {
  const d = b.data as Record<string, unknown>;
  switch (b.type) {
    case "header":
      return `<h2 class="hd">${esc(d.text)}</h2>`;
    case "text":
      return `<p class="tx">${esc(d.text)}</p>`;
    case "link": {
      // Placeholder URLs are saveable but never rendered — an unfilled
      // template link doesn't exist as far as the public page knows.
      if (!isFilledUrl(d.url)) return "";
      const url = safeUrl(d.url);
      const iconHtml = iconMarkup(d.icon);
      const icon = iconHtml ? `<span class="ic">${iconHtml}</span>` : "";
      return `<a class="lk${iconHtml ? "" : " noic"}" href="${esc(go(origin, m, b.id, url))}" rel="noopener">${icon}<span>${esc(d.label)}</span><span class="ar">›</span></a>`;
    }
    case "social":
      // Social profiles are identity, not content — they render as the
      // brand-icon row in the page header, not here.
      return "";
    case "giveaway": {
      // The giveaway card — a stateful invitation. The card renders from
      // the manifest (prize/close time); the live entry flow and draw
      // state live at /r/:id, server-rendered per request.
      const rid = typeof d.raffleId === "string" ? d.raffleId : "";
      if (!rid || !d.prize) return "";
      const closed = d.closesAt ? Date.now() >= new Date(String(d.closesAt)).getTime() : false;
      // The tagline is the OWNER'S voice (Marisa's ask — her clients
      // should read her words, not our compliance poetry). The fairness
      // math didn't move an inch; its receipts live at /r/:id/verify
      // and the plain-words tour at /fair.
      const tagline =
        typeof d.tagline === "string" && d.tagline.trim() ? d.tagline.trim() : "free to enter";
      const sub = closed
        ? "entries closed — winner on the way"
        : `${esc(tagline)}${d.closesAt ? ` · closes ${esc(new Date(String(d.closesAt)).toUTCString().replace(":00 GMT", " GMT"))}` : ""}`;
      return `<a class="lk gvw" href="${esc(origin)}/r/${esc(rid)}" rel="noopener">
  <span class="ic">🎁</span>
  <span><b>${esc(d.prize)}</b><i class="gvs">${sub}</i></span>
  <span class="ar">${closed ? "›" : "→"}</span>
</a>`;
    }
    case "whatsapp": {
      // One tap, chat open, message already typed. Routed through /go so
      // the owner sees the tap in stats like any other link.
      const href = whatsappHref(d.phone, d.message);
      if (!href) return "";
      const label = String(d.label ?? "").trim() || "Chat on WhatsApp";
      const glyph = brandGlyph("whatsapp");
      const icon = glyph
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${glyph}"/></svg>`
        : "💬";
      return `<a class="lk wa" href="${esc(go(origin, m, b.id, href))}" rel="noopener">
  <span class="ic">${icon}</span>
  <span>${esc(label)}</span>
  <span class="ar">›</span>
</a>`;
    }
    case "upi": {
      // Payer → payee, direct. We are not in this transaction: no gateway,
      // no custody, no cut. The VPA is printed in the open because that is
      // what actually gets people paid — someone whose UPI app doesn't
      // catch the intent link can still type the address by hand.
      //
      // Deliberately absent: any "paid"/"verified" affordance. A UPI intent
      // has no callback, so this page cannot know. Claiming otherwise would
      // be the exact kind of rounding-up we don't do.
      const href = upiHref(d);
      if (!href) return "";
      const label = String(d.label ?? "").trim() || "Pay with UPI";
      const amt = typeof d.amount === "number" ? d.amount : Number(d.amount);
      const amountTag =
        Number.isFinite(amt) && amt > 0
          ? `<i class="upia">₹${esc(amt.toFixed(2).replace(/\.00$/, ""))}</i>`
          : "";
      const note = String(d.note ?? "").trim();
      // Three ways to pay, because one of them only works on a phone.
      // The intent link is mobile-only: a desktop OS has no handler for
      // `upi:` and offers whatever it can find (Mark got WhatsApp, which
      // really is a registered UPI app — correct of the OS, useless to
      // him). The QR covers desktop, and the printed VPA covers both.
      return `<a class="lk upi" href="${esc(href)}" rel="noopener">
  <span class="ic">₹</span>
  <span><b>${esc(label)}</b>${note ? `<i class="upin">${esc(note)}</i>` : ""}</span>
  ${amountTag || '<span class="ar">›</span>'}
</a>
<details class="upiq">
  <summary>On a computer? Scan to pay</summary>
  <img src="${esc(origin)}/upi/${esc(m.identityId)}/${esc(b.id)}.svg"
       alt="UPI QR code to pay ${esc(String(d.vpa))}" width="180" height="180" loading="lazy" />
</details>
<p class="upiv">or pay <code>${esc(String(d.vpa))}</code> from any UPI app</p>`;
    }
    case "product": {
      // A product card that leads to the buy page rather than paying
      // inline: the buyer needs somewhere to come BACK to after their UPI
      // app takes over, and that return step is where the reference
      // number gets captured. `deliverable` is deliberately not rendered.
      const price = typeof d.price === "number" ? d.price : Number(d.price);
      if (!d.title || !Number.isFinite(price) || price <= 0 || !productUpiHref(d)) return "";
      const blurb = String(d.blurb ?? "").trim();
      return `<a class="lk prod" href="${esc(origin)}/buy/${esc(m.identityId)}/${esc(b.id)}" rel="noopener">
  <span class="ic">⬗</span>
  <span><b>${esc(d.title)}</b>${blurb ? `<i class="prods">${esc(blurb)}</i>` : ""}</span>
  <i class="upia">₹${esc(price.toFixed(2).replace(/\.00$/, ""))}</i>
</a>`;
    }
    case "booking": {
      // Same destination as a product — the buy page owns slot choice,
      // payment and the claim. The card's job is just to say what it is
      // and what it costs.
      const price = typeof d.price === "number" ? d.price : Number(d.price);
      const slots = Array.isArray(d.slots) ? (d.slots as unknown[]).filter(Boolean) : [];
      if (!d.title || !Number.isFinite(price) || price <= 0 || !productUpiHref(d)) return "";
      // No slots left means nothing to sell; showing the card anyway would
      // walk someone to a dead end after they'd already decided to buy.
      if (!slots.length) return "";
      const meta = [String(d.duration ?? "").trim(), `${slots.length} time${slots.length === 1 ? "" : "s"} open`]
        .filter(Boolean)
        .join(" · ");
      return `<a class="lk prod" href="${esc(origin)}/buy/${esc(m.identityId)}/${esc(b.id)}" rel="noopener">
  <span class="ic">◷</span>
  <span><b>${esc(d.title)}</b>${meta ? `<i class="prods">${esc(meta)}</i>` : ""}</span>
  <i class="upia">₹${esc(price.toFixed(2).replace(/\.00$/, ""))}</i>
</a>`;
    }
    case "gallery": {
      // The portfolio surface (Marisa's ask: "shouldn't we have some
      // photos to show our work"). Zero-JS by religion: a scroll-snap
      // strip — swipe-native on the phones clients actually hold, the
      // next photo peeking in as the affordance. No timers, no script.
      const raw = Array.isArray(d.images) ? (d.images as Array<Record<string, unknown>>) : [];
      const imgs = raw
        .filter((im) => typeof im?.url === "string" && /^https:\/\//.test(im.url as string))
        .slice(0, 12);
      if (!imgs.length) return "";
      return `<div class="gal">${imgs
        .map((im, i) => {
          const cap = typeof im.caption === "string" && im.caption.trim() ? im.caption.trim() : "";
          return `<figure class="gali">
  <img src="${esc(String(im.url))}" alt="${esc(cap || `photo ${i + 1}`)}" loading="lazy" decoding="async" />
  ${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}
</figure>`;
        })
        .join("")}</div>`;
    }
    case "surfaces": {
      // The Save & share module: this identity's sibling surfaces as
      // tappable chips. Human trio (vCard/QR/card) defaults ON when
      // undefined; machine surfaces (md/JSON) must be explicitly true.
      const page = `${origin}/${esc(m.handle)}`;
      const chips: string[] = [];
      if (d.vcard !== false) chips.push(`<a class="sfb" href="${page}?format=vcard">📇 Save contact</a>`);
      if (d.qr !== false) chips.push(`<a class="sfb" href="${page}?format=qr">▦ QR code</a>`);
      if (d.card !== false) chips.push(`<a class="sfb" href="${page}?format=card">🪪 Business card</a>`);
      if (d.md === true) chips.push(`<a class="sfb" href="${page}.md">📄 Markdown</a>`);
      if (d.json === true) chips.push(`<a class="sfb" href="${page}?format=json">〈/〉 JSON</a>`);
      if (!chips.length) return "";
      const title = d.title ? `<h2 class="hd">${esc(d.title)}</h2>` : "";
      return `${title}<div class="sf">${chips.join("")}</div>`;
    }
    case "embed": {
      if (!isFilledUrl(d.url)) return "";
      const src = embedFrame(String(d.url ?? ""));
      if (src) {
        return `<div class="em"><iframe src="${esc(src)}" title="${esc(d.title || "Embedded media")}" loading="lazy" allowfullscreen allow="encrypted-media"></iframe></div>`;
      }
      return `<a class="lk noic" href="${esc(go(origin, m, b.id, safeUrl(d.url)))}" rel="noopener"><span>${esc(d.title || d.url)}</span><span class="ar">›</span></a>`;
    }
    default:
      return "";
  }
}

export function renderProfileHtml(m: IdentityManifest, ctx: RenderContext): string {
  const t: ThemePalette = applyBackground(
    m.themeCustom ?? THEMES[m.theme ?? "pro"] ?? THEMES.pro,
    m.background,
  );
  const origin = ctx.origin;
  const brand = esc(ctx.brand ?? "NEDB Links");
  const url = `${origin}/${esc(m.handle)}`;
  // Custom search & sharing (premium) overrides; empty = automatic.
  const seo = m.seo ?? {};
  const title = seo.title?.trim()
    ? esc(seo.title.trim())
    : `${esc(m.displayName)} (@${esc(m.handle)})`;
  const desc = seo.description?.trim()
    ? esc(seo.description.trim())
    : esc(m.bio ?? `${m.displayName} on ${ctx.brand ?? "NEDB Links"}`);
  // The share card — https only; a card image upgrades the twitter card.
  const shareImage =
    typeof seo.image === "string" && /^https:\/\//.test(seo.image) ? esc(seo.image) : "";
  const avatar = m.avatar
    ? `<img class="av" src="${esc(safeUrl(m.avatar))}" alt="${esc(m.displayName)}" />`
    : `<div class="av avf">${esc(m.displayName.slice(0, 1).toUpperCase())}</div>`;
  const blocks = [...m.blocks]
    .sort((a, b) => a.order - b.order)
    .map((b) => renderBlock(b, m, origin))
    .join("\n");
  const fonts = fontAssets(m);

  // The icon row — every filled social link across the manifest, brand
  // glyph auto-detected, click-tracked, right under the bio. The second
  // thing a visitor sees.
  const socialLinks = m.blocks
    .filter((b) => b.type === "social")
    .flatMap((b) => {
      const links = Array.isArray((b.data as Record<string, unknown>).links)
        ? ((b.data as Record<string, unknown>).links as Array<Record<string, unknown>>)
        : [];
      return links
        .filter((l) => isFilledUrl(l.url))
        .map((l) => ({
          blockId: b.id,
          network: String(l.network ?? ""),
          url: safeUrl(l.url),
        }));
    });
  const socialRow = socialLinks.length
    ? `<div class="si">${socialLinks
        .map((l) => {
          const g = socialGlyph(l.network, l.url);
          return `<a class="sb" href="${esc(go(origin, m, l.blockId, l.url))}" rel="noopener" title="${esc(g.label)}" aria-label="${esc(g.label)}"><svg viewBox="0 0 24 24" role="img" aria-hidden="true">${g.inner}</svg></a>`;
        })
        .join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="profile" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${url}" />
${shareImage ? `<meta property="og:image" content="${shareImage}" />\n<meta name="twitter:image" content="${shareImage}" />` : ""}
<meta name="twitter:card" content="${shareImage ? "summary_large_image" : "summary"}" />
<link rel="canonical" href="${url}" />
${ctx.favicon && assetUrl(ctx.favicon) ? `<link rel="icon" href="${esc(assetUrl(ctx.favicon))}" /><link rel="apple-touch-icon" href="${esc(assetUrl(ctx.favicon))}" />` : ""}
<link rel="alternate" type="text/markdown" href="${url}.md" title="Markdown" />
<link rel="alternate" type="application/json" href="${url}?format=json" title="JSON" />
<link rel="alternate" type="text/vcard" href="${url}?format=vcard" title="vCard" />
${fonts.link}
<style>
  :root { color-scheme: dark light; }
  * { margin: 0; box-sizing: border-box; }
  body {
    background: ${t.bg}; color: ${pageText(t)};
    font: 16px/1.55 ${fonts.bodyCss};
    min-height: 100dvh; display: flex; justify-content: center;
    position: relative;
  }
  /* Atmosphere — a soft accent aurora behind the header. Pure CSS,
     per-theme, invisible on printouts. */
  body::before {
    content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(60% 34% at 50% -4%, ${t.accent}24, transparent 70%),
      radial-gradient(42% 26% at 82% 8%, ${t.accent}10, transparent 70%);
  }
  h1, .hd { font-family: ${fonts.headingCss}; }
  main { width: 100%; max-width: 600px; padding: 56px 22px 72px; position: relative; z-index: 1; }

  /* Staggered entrance — CSS only, killed by reduced-motion. */
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .id { animation: rise 0.5s ease both; }
  section > * { animation: rise 0.5s ease both; }
  section > *:nth-child(1) { animation-delay: 0.06s; }
  section > *:nth-child(2) { animation-delay: 0.1s; }
  section > *:nth-child(3) { animation-delay: 0.14s; }
  section > *:nth-child(4) { animation-delay: 0.18s; }
  section > *:nth-child(5) { animation-delay: 0.22s; }
  section > *:nth-child(n+6) { animation-delay: 0.26s; }
  footer { animation: rise 0.5s ease 0.3s both; }

  .id { text-align: center; margin-bottom: 34px; }
  /* Avatar in a gradient ring, floating on a soft glow. */
  .avw { display: inline-block; padding: 3px; border-radius: 50%;
         background: linear-gradient(140deg, ${t.accent}, ${t.accent}22 70%);
         box-shadow: 0 10px 34px -10px ${t.accent}66; }
  .av { display: block; width: 96px; height: 96px; border-radius: 50%;
        object-fit: cover; border: 3px solid ${solidBg(t)}; }
  .avf { display: flex; align-items: center; justify-content: center;
         font-size: 40px; font-weight: 800; color: ${t.accent};
         background: ${t.card}; }
  h1 { font-size: 28px; font-weight: 800; margin-top: 16px; letter-spacing: -0.025em; }
  .hn { color: ${t.accent}; font-size: 14px; font-weight: 600; margin-top: 3px; }
  .bio { color: ${pageSub(t)}; font-size: 15.5px; margin: 12px auto 0; max-width: 42ch; }

  .hd { font-size: 12px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.14em; color: ${pageSub(t)}; margin: 30px 6px 6px; }
  .tx { color: ${pageSub(t)}; font-size: 15px; margin: 10px 6px; }

  /* Link cards — weight, hierarchy, and a chevron that leans in. */
  .lk { display: flex; align-items: center; gap: 12px;
        background: ${t.card}; color: ${t.text}; text-decoration: none;
        border: 1px solid ${t.accent}26; border-radius: 16px;
        padding: 16px 18px; margin: 12px 0; font-weight: 600; font-size: 16px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 8px 24px -14px ${t.accent}40;
        transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .lk:hover { transform: translateY(-2px); border-color: ${t.accent}77;
              box-shadow: 0 2px 4px rgba(0,0,0,0.08), 0 14px 34px -14px ${t.accent}59; }
  .lk:active { transform: scale(0.99); }
  .ic { display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 11px; flex: none;
        color: ${t.accent}; background: ${t.accent}14; font-size: 17px; }
  .ic svg { width: 19px; height: 19px; fill: currentColor; }
  /* Labels center on the CARD, icon or not (Mark's spec, 7/9): the
     icon (36px + 12 gap) and the arrow (~12px + 12 gap) flank the label
     asymmetrically, so a naive center drifts right — the padding
     compensates each case back to true card-center. The giveaway card
     opts back out below: its poster layout is left-set on purpose. */
  .lk > span:not(.ic):not(.ar) { flex: 1; text-align: center; padding-right: 24px; min-width: 0; }
  .lk.noic > span:not(.ar) { padding-right: 0; padding-left: 24px; }
  .gvw > span:not(.ic):not(.ar) { text-align: left; padding-right: 0; }
  .ar { flex: none; color: ${t.accent}; opacity: 0.55; font-weight: 700;
        transition: transform 0.15s ease, opacity 0.15s ease; }
  .lk:hover .ar { transform: translateX(3px); opacity: 1; }

  /* Giveaway card — POP ART, not a circus wheel: a tight curated
     palette (giveawayStops), a fully OPAQUE card so the ring can never
     bleed into the text (the actual "can't read it" bug — a 5-hue
     rainbow ring showing through a translucent card), and a bold
     screen-print outline instead of a soft glassy blur. The ring still
     spins for dopamine; it just reads as a poster frame, not a wheel.
     Reduced-motion freezes it in place. */
  @property --gvang { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
  @keyframes gvspin { to { --gvang: 360deg; } }
  /* The ring is painted in the element's OWN border-box layer — the
     canonical gradient-border technique. NOT a z-index:-1 pseudo:
     that approach silently breaks whenever the card becomes a
     stacking context, and this card does constantly (the entrance
     animation animates opacity+transform; :active scales; .lk carries
     backdrop-filter) — each one trapped the ring ABOVE the face and
     flooded the card with gradient. Caught live, twice, by computed-
     style instrumentation. This layering is immune to all of it. */
  .gvw { position: relative; border: 3px solid transparent;
         /* The face is the theme's CARD surface — the ink (.gvw b uses
            t.text, .gvs uses t.sub) was DESIGNED for that surface, so
            the pairing is readable by the theme's own contract. It sits
            composited over the solid canvas anchor so the stack stays
            fully opaque (the ring can never bleed through). A bare
            solidBg face was the Marisa bug: with a custom background,
            solidBg tracks the background's anchor — her pink canvas
            became the card face while the ink stayed card-light.
            Canvas comes from the background; CARDS come from the theme. */
         background:
           linear-gradient(${t.card}, ${t.card}) padding-box,
           linear-gradient(${solidBg(t)}, ${solidBg(t)}) padding-box,
           conic-gradient(from var(--gvang), ${conicStops(ctx.holoColors)}) border-box;
         animation: rise 0.5s ease both, gvspin 9s linear infinite;
         -webkit-backdrop-filter: none; backdrop-filter: none;
         box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), 0 8px 24px -14px ${t.accent}40; }
  .gvw:hover { animation: rise 0.5s ease both, gvspin 3s linear infinite; }
  .gvw:active { transform: scale(.985); }
  .gvw .ic { animation: gvpop 2.8s cubic-bezier(.34,1.56,.64,1) infinite; }
  @keyframes gvpop { 0%, 80%, 100% { transform: scale(1) rotate(0); } 88% { transform: scale(1.16) rotate(-4deg); } 94% { transform: scale(1.05) rotate(2deg); } }
  .gvw b { display: block; text-shadow: 2px 2px 0 ${giveawayStops(ctx.holoColors)[0]}55; }
  .gvs { display: block; font-style: normal; font-weight: 500; font-size: 12px;
         color: ${t.sub}; margin-top: 2px; }

  /* WhatsApp — the brand green earns its place here: on an Indian phone
     this glyph IS the affordance, recognised before the label is read. */
  .wa .ic svg { fill: #25D366; }

  /* UPI — reads as money without shouting. The amount sits where the
     chevron would, because the price IS the call to action. The VPA line
     underneath is the fallback path for anyone whose app misses the
     intent link, and it is deliberately plain text: no fake receipt, no
     "verified" badge. This page cannot know whether a UPI intent was
     ever paid, and it must not pretend otherwise. */
  .upi b { display: block; }
  .upin { display: block; font-style: normal; font-weight: 500; font-size: 12px;
          color: ${t.sub}; margin-top: 2px; }
  .upia { font-style: normal; font-weight: 700; font-size: 15px; color: ${t.accent};
          white-space: nowrap; margin-left: auto; padding-left: 10px; }
  .upiv { font-size: 12px; color: ${pageSub(t)}; text-align: center;
          margin: -4px 0 12px; }
  /* Scan-to-pay, collapsed by default: on the phones most visitors hold,
     the intent link above already works and a 180px QR would just push
     the rest of the page down. <details> keeps it one tap away with no
     script at all. */
  .upiq { margin: -2px 0 8px; text-align: center; }
  .upiq summary { font-size: 12px; color: ${pageSub(t)}; cursor: pointer;
                  list-style: none; padding: 6px; }
  .upiq summary::-webkit-details-marker { display: none; }
  .upiq summary:hover { color: ${t.accent}; }
  /* White plate, always: a QR inverted onto a dark card scans badly on
     many phone cameras, and this one is the difference between getting
     paid and not. */
  .upiq img { display: block; margin: 6px auto 2px; background: #fff;
              border-radius: 12px; padding: 8px; width: 180px; height: 180px; }
  .prod b { display: block; }
  .prods { display: block; font-style: normal; font-weight: 500; font-size: 12px;
           color: ${t.sub}; margin-top: 2px; }
  .upiv code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
               font-size: 12px; color: ${t.text}; background: ${t.card};
               border-radius: 6px; padding: 2px 6px; }

  /* Gallery — a scroll-snap portfolio strip. 82% cards leave the next
     photo peeking in (the swipe affordance); captions sit on the page
     canvas so they use page ink. Zero JS, native momentum. */
  .gal { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory;
         margin: 12px 0; padding: 2px 2px 6px; -webkit-overflow-scrolling: touch;
         scrollbar-width: none; }
  .gal::-webkit-scrollbar { display: none; }
  .gali { flex: 0 0 82%; scroll-snap-align: center; margin: 0; }
  .gal .gali:only-child { flex-basis: 100%; }
  .gali img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; display: block;
              border-radius: 16px; border: 1px solid ${t.accent}26;
              box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 8px 24px -14px ${t.accent}40;
              background: ${t.card}; }
  .gali figcaption { font-size: 12.5px; color: ${pageSub(t)}; margin-top: 7px;
                     text-align: center; }

  /* Save & share chips — sibling surfaces as quiet pills. */
  .sf { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 12px 0; }
  .sfb { display: inline-flex; align-items: center; gap: 7px;
         padding: 9px 15px; border-radius: 999px; font-weight: 600; font-size: 13.5px;
         background: ${t.card}; color: ${t.text}; text-decoration: none;
         border: 1px solid ${t.accent}26;
         box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 6px 18px -10px ${t.accent}40;
         transition: transform 0.15s ease, border-color 0.15s ease;
         -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .sfb:hover { transform: translateY(-2px); border-color: ${t.accent}77; }

  .si { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 18px; }
  .sb { width: 44px; height: 44px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        color: ${t.accent}; background: ${t.card};
        border: 1px solid ${t.accent}33; text-decoration: none;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 6px 18px -10px ${t.accent}40;
        transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .sb:hover { transform: translateY(-2px); border-color: ${t.accent}99;
              box-shadow: 0 2px 4px rgba(0,0,0,0.08), 0 10px 24px -10px ${t.accent}59; }
  .sb svg { width: 21px; height: 21px; fill: currentColor; }

  .em { margin: 12px 0; border-radius: 16px; overflow: hidden; aspect-ratio: 16/9;
        border: 1px solid ${t.accent}26;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 8px 24px -14px ${t.accent}40; }
  .em iframe { width: 100%; height: 100%; border: 0; }

  footer { text-align: center; margin-top: 52px; }
  footer a { display: inline-flex; align-items: center; gap: 6px;
             color: ${pageSub(t)}; font-size: 12px; text-decoration: none;
             border: 1px solid ${t.accent}1f; border-radius: 999px;
             padding: 7px 14px; transition: border-color 0.15s ease, color 0.15s ease; }
  footer a:hover { border-color: ${t.accent}55; color: ${pageText(t)}; }
  footer a b { color: ${t.accent}; font-weight: 700; }
  footer a .blg { width: 16px; height: 16px; object-fit: contain; display: inline-block;
                  vertical-align: -3px; margin-right: 2px; }

  @media (prefers-reduced-motion: reduce) {
    .id, section > *, footer { animation: none; }
    .lk, .sb, .ar { transition: none; }
    .gvw, .gvw .ic { animation: none; }
  }
</style>
</head>
<body>
<main>
  <header class="id">
    <div class="avw">${avatar}</div>
    <h1>${esc(m.displayName)}</h1>
    <div class="hn">@${esc(m.handle)}</div>
    ${m.bio ? `<p class="bio">${esc(m.bio)}</p>` : ""}
    ${socialRow}
  </header>
  <section>
${blocks}
  </section>
  <footer>
    <a href="${origin}" rel="noopener">${ctx.brandLogo && assetUrl(ctx.brandLogo) ? `<img class="blg" src="${esc(assetUrl(ctx.brandLogo))}" alt="" />` : `<b>⬡</b>`} published with ${brand}</a>
  </footer>
</main>
</body>
</html>`;
}

export const htmlRenderer = defineRenderer({
  id: "html",
  name: "Profile page",
  description: "The public profile — server-rendered, mobile-first, no client JS.",
  consumes: ["shareable", "embeddable", "interactive", "seo"],
  render: (manifest, ctx) => ({
    contentType: "text/html; charset=utf-8",
    body: renderProfileHtml(manifest, ctx),
  }),
});
