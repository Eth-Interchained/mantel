/**
 * Business card renderer — the physical-world surface.
 *
 * Two modes from one URL:
 *   - Screen: a full-viewport digital card with save-contact and
 *     open-profile actions. This is what gets AirDropped, texted, and
 *     shown across a counter.
 *   - Print: @page 3.5in × 2in — a true US business card front. The
 *     browser's print dialog (or print-to-PDF) produces press-ready
 *     output. Actions and chrome disappear; the card remains.
 *
 * The embedded QR carries ?src=qr, so cards printed today keep feeding
 * analytics forever — and because it encodes the handle URL backed by
 * an immutable identityId with rename redirects, a card printed today
 * still works after every rebrand.
 */

import type { IdentityManifest } from "../identity";
import { defineRenderer, type RenderContext } from "../registry";
import { esc, fontAssets, solidBg, THEMES } from "./html";
import { buildQrSvg, shareUrl } from "./qr";

export async function renderCardHtml(
  m: IdentityManifest,
  ctx: RenderContext,
): Promise<string> {
  const t = m.themeCustom ?? THEMES[m.theme ?? "pro"] ?? THEMES.pro;
  const origin = ctx.origin;
  const profileUrl = `${origin}/${m.handle}`;
  const qrSvg = await buildQrSvg(shareUrl(m, origin), {
    dark: "#0f172a",
    light: "#ffffff",
  });
  const fonts = fontAssets(m);
  const title = `${esc(m.displayName)} — business card`;
  const initial = esc(m.displayName.slice(0, 1).toUpperCase());
  const avatar = m.avatar && /^https?:\/\//i.test(m.avatar)
    ? `<img class="av" src="${esc(m.avatar)}" alt="${esc(m.displayName)}" />`
    : `<div class="av avf">${initial}</div>`;
  const org =
    m.identityType === "business" || m.identityType === "organization"
      ? `<div class="org">${esc(m.bio ?? "")}</div>`
      : m.bio
        ? `<div class="org">${esc(m.bio)}</div>`
        : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${esc(m.displayName)} (@${esc(m.handle)}) — digital business card" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${esc(m.bio ?? `@${m.handle}`)}" />
<meta property="og:url" content="${esc(profileUrl)}/card" />
<meta name="robots" content="noindex" />
${fonts.link}
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: ${t.bg};
    color: ${t.text};
    font: 15px/1.45 ${fonts.bodyCss};
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 22px; padding: 24px;
  }

  /* ── The card ─────────────────────────────────────────────────────── */
  .card {
    width: min(92vw, 520px);
    aspect-ratio: 1.75;                /* 3.5 × 2 — true card proportions */
    border-radius: 18px;
    background: linear-gradient(135deg, ${t.card.slice(0, 7)}, ${solidBg(t)});
    border: 1px solid ${t.accent}33;
    box-shadow: 0 0 0 1px ${t.accent}1a, 0 24px 80px -24px ${t.accent}40;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 14px;
    padding: clamp(16px, 4vw, 28px);
    overflow: hidden;
    position: relative;
  }
  .card::before {
    content: "";
    position: absolute; inset: 0;
    background: radial-gradient(120% 90% at 0% 0%, ${t.accent}14, transparent 55%);
    pointer-events: none;
  }
  .who { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .av { width: clamp(40px, 9vw, 56px); height: clamp(40px, 9vw, 56px);
        border-radius: 50%; object-fit: cover; border: 2px solid ${t.accent}66; }
  .avf { display: flex; align-items: center; justify-content: center;
         font-weight: 800; font-size: clamp(18px, 4vw, 24px);
         color: ${t.accent}; background: ${solidBg(t)}; }
  h1 { font-family: ${fonts.headingCss}; font-size: clamp(18px, 4.6vw, 26px); font-weight: 800;
       letter-spacing: -0.02em; margin-top: 10px;
       white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hn { color: ${t.accent}; font-weight: 700; font-size: clamp(12px, 3vw, 14px); }
  .org { color: ${t.sub}; font-size: clamp(11px, 2.8vw, 13px); margin-top: 8px;
         display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
         overflow: hidden; }
  .brand { position: absolute; left: clamp(16px, 4vw, 28px); bottom: 10px;
           font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
           color: ${t.sub}99; }
  .qr { align-self: center; width: clamp(84px, 22vw, 128px);
        aspect-ratio: 1; border-radius: 10px; overflow: hidden;
        background: #ffffff; padding: 4px; }
  .qr svg { display: block; width: 100%; height: 100%; }

  /* ── Actions (screen only) ────────────────────────────────────────── */
  .actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .actions a {
    text-decoration: none; font-weight: 700; font-size: 14px;
    border-radius: 12px; padding: 12px 18px;
    transition: transform 0.12s ease, filter 0.12s ease;
  }
  .actions a:hover { transform: translateY(-1px); filter: brightness(1.1); }
  .primary { background: ${t.accent}; color: ${solidBg(t)}; }
  .ghost { border: 1px solid ${t.accent}55; color: ${t.accent}; }
  .hint { color: ${t.sub}; font-size: 12px; }

  /* ── Print: a true 3.5in × 2in card front ─────────────────────────── */
  @media print {
    @page { size: 3.5in 2in; margin: 0; }
    body { padding: 0; background: ${t.bg}; }
    .card {
      width: 3.5in; height: 2in; aspect-ratio: auto;
      border-radius: 0; border: none; box-shadow: none;
      padding: 0.18in;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="who">
      ${avatar}
      <h1>${esc(m.displayName)}</h1>
      <div class="hn">@${esc(m.handle)} · ${esc(origin.replace(/^https?:\/\//, ""))}</div>
      ${org}
      <div class="brand">⬡ ${esc(ctx.brand ?? "NEDB Links")}</div>
    </div>
    <div class="qr">${qrSvg}</div>
  </div>

  <div class="actions no-print">
    <a class="primary" href="${esc(profileUrl)}?format=vcard">Save contact</a>
    <a class="ghost" href="${esc(profileUrl)}?src=card">Open profile</a>
    <a class="ghost" href="javascript:window.print()">Print</a>
  </div>
  <p class="hint no-print">Print produces a true 3.5in × 2in card front — or save as PDF.</p>
</body>
</html>`;
}

export const cardRenderer = defineRenderer({
  id: "card",
  name: "Business card",
  description:
    "A digital business card with embedded scan-tracked QR — screen-shareable, and print-true at 3.5in × 2in.",
  consumes: ["printable", "qr", "shareable"],
  render: async (manifest: IdentityManifest, ctx: RenderContext) => ({
    contentType: "text/html; charset=utf-8",
    body: await renderCardHtml(manifest, ctx),
  }),
});
