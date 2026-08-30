/**
 * Renderer suite — the publish loop outputs, held to spec.
 *
 * Run: npm test  (node:test via tsx — no framework dependency)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SCHEMA_VERSION, type IdentityManifest } from "../src/lib/identity";
import { getRenderer, listRenderers, manifestCapabilities } from "../src/lib/registry";
import "../src/lib/blocks/builtin";
import "../src/lib/templates/builtin";
import { renderProfileHtml } from "../src/lib/renderers/html";
import { renderCardHtml } from "../src/lib/renderers/card";
import { buildQrPng, buildQrSvg, shareUrl } from "../src/lib/renderers/qr";
import { buildVcard, vEscape, vFold, vName, vRev } from "../src/lib/renderers/vcard";

const CTX = { origin: "https://links.example.com" };

function fixture(overrides: Partial<IdentityManifest> = {}): IdentityManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    identityId: "idn_test1234567890abcdef",
    identityType: "business",
    owner: "admin",
    handle: "marisayvettehair",
    displayName: "Marisa Yvette",
    bio: "Book your next appointment; walk-ins welcome, too.",
    theme: "rosegold",
    blocks: [
      { id: "blk_1", type: "link", order: 0, data: { label: "Book an appointment", url: "https://book.example.com", icon: "✂" } },
      { id: "blk_2", type: "link", order: 1, data: { label: "Call us", url: "tel:+14075551234" } },
      { id: "blk_3", type: "link", order: 2, data: { label: "Email", url: "mailto:hello@example.com" } },
      { id: "blk_4", type: "social", order: 3, data: { links: [{ network: "Instagram", url: "https://instagram.com/marisa" }] } },
      { id: "blk_5", type: "header", order: 4, data: { text: "Hours" } },
    ],
    capabilities: [],
    renderers: [],
    status: "published",
    publishedAt: "2026-07-05T12:00:00.000Z",
    createdAt: "2026-07-05T11:00:00.000Z",
    updatedAt: "2026-07-05T12:34:56.789Z",
    ...overrides,
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

test("all five surfaces are registered renderers", async () => {
  await import("../src/lib/renderers/json");
  const ids = listRenderers().map((r) => r.id).sort();
  for (const id of ["card", "html", "json", "qr", "vcard"]) {
    assert.ok(ids.includes(id), `renderer registered: ${id}`);
  }
});

test("capabilities aggregate from block definitions", () => {
  const caps = manifestCapabilities(fixture().blocks);
  assert.ok(caps.includes("qr"), "link blocks advertise qr");
  assert.ok(caps.includes("printable"), "header blocks advertise printable");
});

// ── vCard: spec compliance ───────────────────────────────────────────────────

test("vCard uses CRLF line endings exclusively", () => {
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(v.includes("\r\n"), "contains CRLF");
  assert.equal(v.replaceAll("\r\n", "").includes("\n"), false, "no bare LF remains");
  assert.ok(v.endsWith("END:VCARD\r\n"), "terminates with END:VCARD CRLF");
});

test("vCard escapes TEXT values per RFC 2426", () => {
  assert.equal(vEscape("a,b;c\nd\\e"), "a\\,b\\;c\\nd\\\\e");
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(
    v.includes("NOTE:Book your next appointment\\; walk-ins welcome\\, too."),
    "bio semicolons and commas escaped",
  );
});

test("vCard folds lines longer than 75 octets", () => {
  const long = "NOTE:" + "x".repeat(200);
  const folded = vFold(long);
  for (const physical of folded.split("\r\n")) {
    assert.ok(
      new TextEncoder().encode(physical).length <= 75,
      `physical line within 75 octets: ${physical.length}`,
    );
  }
  assert.ok(folded.includes("\r\n "), "continuation lines begin with a space");
  const bio = "long ".repeat(60);
  const v = buildVcard(fixture({ bio }), CTX.origin);
  const unfolded = v.replaceAll("\r\n ", "");
  assert.ok(unfolded.includes(bio.trimEnd().replaceAll(",", "\\,")), "unfolding restores content");
});

test("vCard N parses display names best-effort", () => {
  assert.equal(vName("Marisa Yvette"), "Yvette;Marisa;;;");
  assert.equal(vName("Cher"), ";Cher;;;");
  assert.equal(vName("Mary Jane Watson"), "Watson;Mary Jane;;;");
});

test("vCard carries stable UID from immutable identityId", () => {
  const a = buildVcard(fixture(), CTX.origin);
  const b = buildVcard(fixture({ displayName: "Renamed Entirely" }), CTX.origin);
  const uid = "UID:urn:nedb-links:idn_test1234567890abcdef";
  assert.ok(a.includes(uid) && b.includes(uid), "UID survives display renames");
});

test("vCard maps tel:/mailto: links to TEL and EMAIL", () => {
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(v.includes("TEL;TYPE=VOICE:+14075551234"));
  assert.ok(v.includes("EMAIL;TYPE=INTERNET:hello@example.com"));
});

test("vCard labels URLs for iOS and lists social profiles", () => {
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(v.includes("item1.URL:https://book.example.com"));
  assert.ok(v.includes("item1.X-ABLabel:Book an appointment"));
  assert.ok(v.includes("X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/marisa"));
});

test("vCard REV derives from updatedAt", () => {
  assert.equal(vRev("2026-07-05T12:34:56.789Z"), "20260705T123456Z");
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(v.includes("REV:20260705T123456Z"));
});

test("vCard marks business identities with ORG", () => {
  const v = buildVcard(fixture(), CTX.origin);
  assert.ok(v.includes("ORG:Marisa Yvette"));
  const p = buildVcard(fixture({ identityType: "personal" }), CTX.origin);
  assert.equal(p.includes("ORG:"), false);
});

// ── QR ───────────────────────────────────────────────────────────────────────

test("share URL carries the qr source tag", () => {
  assert.equal(
    shareUrl(fixture(), CTX.origin),
    "https://links.example.com/marisayvettehair?src=qr",
  );
});

test("QR SVG is embeddable markup", async () => {
  const svg = await buildQrSvg("https://links.example.com/x?src=qr");
  assert.ok(svg.includes("<svg"), "svg root present");
  assert.ok(svg.includes("path"), "modules drawn");
});

test("QR PNG carries the PNG signature at print resolution", async () => {
  const png = await buildQrPng("https://links.example.com/x?src=qr", 1024);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((byte, i) => assert.equal(png[i], byte, `PNG magic byte ${i}`));
  assert.ok(png.length > 1000, "non-trivial payload");
});

test("QR renderer honors type and download options", async () => {
  const qr = getRenderer("qr");
  assert.ok(qr, "qr renderer registered");
  const svg = await qr.render(fixture(), { ...CTX, options: {} });
  assert.equal(svg.contentType.startsWith("image/svg+xml"), true);
  assert.equal(svg.filename, undefined, "inline by default");
  const png = await qr.render(fixture(), { ...CTX, options: { type: "png", download: "1" } });
  assert.equal(png.contentType, "image/png");
  assert.equal(png.filename, "marisayvettehair-qr.png");
});

// ── Business card ────────────────────────────────────────────────────────────

test("card embeds identity, QR, and save-contact action", async () => {
  const html = await renderCardHtml(fixture(), CTX);
  assert.ok(html.includes("Marisa Yvette"));
  assert.ok(html.includes("@marisayvettehair"));
  assert.ok(html.includes("<svg"), "QR inlined as SVG");
  assert.ok(html.includes("?format=vcard"), "save-contact links the vCard surface");
  assert.ok(html.includes("@page { size: 3.5in 2in; margin: 0; }"), "print-true card size");
});

test("card escapes hostile display names", async () => {
  const html = await renderCardHtml(
    fixture({ displayName: '<script>alert("x")</script>' }),
    CTX,
  );
  assert.equal(html.includes("<script>alert"), false, "no raw script tag");
  assert.ok(html.includes("&lt;script&gt;"), "escaped rendering");
});

// ── Placeholder semantics: saveable, never rendered ──────────────────────────

test("placeholder URLs are saveable but never rendered on any surface", async () => {
  const { getBlock } = await import("../src/lib/registry");
  const linkDef = getBlock("link");
  assert.ok(linkDef, "link block registered");
  // Template default ("https://") validates — drafting never fights the user.
  assert.equal(linkDef.schema.safeParse(linkDef.defaults()).success, true);
  // But a filled invalid string still fails.
  assert.equal(linkDef.schema.safeParse({ label: "x", url: "not a url" }).success, false);

  const m = fixture({
    blocks: [
      { id: "blk_ph", type: "link", order: 0, data: { label: "Unfilled template link", url: "https://" } },
      { id: "blk_ok", type: "link", order: 1, data: { label: "Real link", url: "https://real.example.com" } },
      { id: "blk_soc", type: "social", order: 2, data: { links: [{ network: "x", url: "https://" }] } },
      { id: "blk_emb", type: "embed", order: 3, data: { url: "https://", title: "empty" } },
    ],
  });
  const html = renderProfileHtml(m, CTX);
  assert.equal(html.includes("Unfilled template link"), false, "placeholder link hidden");
  assert.ok(html.includes("Real link"), "filled link renders");
  assert.equal(html.includes('class="si"'), false, "social icon row with only placeholders hidden");
  assert.equal(html.includes('class="em"'), false, "placeholder embed hidden");

  const v = buildVcard(m, CTX.origin);
  assert.equal(v.includes("item1.URL:https://\r\n"), false, "vCard skips placeholder URLs");
  assert.ok(v.includes("item1.URL:https://real.example.com"), "vCard keeps filled URLs");
});

// ── Custom palette (MySpace energy, Links safety) ────────────────────────────

test("a custom palette overrides the named theme on every surface", async () => {
  const custom = { bg: "#112233", card: "#223344", text: "#f0f0f0", sub: "#aabbcc", accent: "#ff6600" };
  const m = fixture({ theme: "midnight", themeCustom: custom });
  const html = renderProfileHtml(m, CTX);
  assert.ok(html.includes("background: #112233"), "custom page color renders");
  assert.ok(html.includes("#ff6600"), "custom accent renders");
  assert.equal(html.includes("#070a12"), false, "named theme fully overridden");

  const card = await renderCardHtml(m, CTX);
  assert.ok(card.includes("#ff6600"), "business card follows the custom palette");
});

test("curated fonts inject Google link and font-family on profile + card", async () => {
  const custom = {
    bg: "#112233", card: "#223344", text: "#f0f0f0", sub: "#aabbcc", accent: "#ff6600",
    headingFont: "playfair" as const, bodyFont: "lora" as const,
  };
  const m = fixture({ themeCustom: custom });
  const html = renderProfileHtml(m, CTX);
  assert.ok(html.includes("fonts.googleapis.com/css2?family=Playfair+Display"), "Google link built from OUR map");
  assert.ok(html.includes("family=Lora"), "body family included");
  assert.ok(html.includes("h1, .hd { font-family: 'Playfair Display', Georgia, serif; }"), "heading font applied");
  assert.ok(html.includes("'Lora', Georgia, serif"), "body font applied");

  const card = await renderCardHtml(m, CTX);
  assert.ok(card.includes("Playfair+Display"), "card loads the same fonts");

  // System default: no external font link at all.
  const plain = renderProfileHtml(fixture(), CTX);
  assert.equal(plain.includes("fonts.googleapis.com"), false, "no fonts link when system");
});

// ── Profile page ─────────────────────────────────────────────────────────────

test("profile page escapes content and routes clicks through /go", () => {
  const html = renderProfileHtml(fixture({ bio: '<img onerror=alert(1)>' }), CTX);
  assert.equal(html.includes("<img onerror"), false, "bio escaped");
  assert.ok(html.includes("/go/idn_test1234567890abcdef/blk_1?to="), "click tracking URLs");
});

test("signal theme — the v3 studio palette is a first-class renderer theme", () => {
  const html = renderProfileHtml(fixture({ theme: "signal" }), CTX);
  assert.ok(html.includes("#0f172a"), "charcoal canvas");
  assert.ok(html.includes("#60a5fa"), "signal blue accent");
  // Unknown themes still fall back to pro — signal must not break that.
  const fallback = renderProfileHtml(fixture({ theme: "definitely-not-real" }), CTX);
  assert.ok(fallback.includes("#0e7490"), "unknown theme falls back to pro accent");
});

test("mach theme — chrome-on-gunmetal renderer palette", () => {
  const html = renderProfileHtml(fixture({ theme: "mach" }), CTX);
  assert.ok(html.includes("#0b0d11"), "gunmetal canvas");
  assert.ok(html.includes("#cbd5e1"), "chrome accent");
});

// ── Social header icons — identity, not content ──────────────────────────────

test("social links render as brand-icon buttons in the header, click-tracked", () => {
  const html = renderProfileHtml(fixture(), CTX);
  assert.ok(html.includes('class="si"'), "icon row renders in the header");
  assert.ok(html.includes('class="sb"'), "icon buttons present");
  assert.ok(html.includes('aria-label="Instagram"'), "accessible label from the typed name");
  assert.ok(html.includes("<svg"), "real SVG glyphs, zero JS");
  assert.ok(html.includes("/go/idn_test1234567890abcdef/blk_4?to="), "icons stay click-tracked");
  // The old mid-page text pills are gone.
  assert.equal(html.includes('class="sr"'), false, "no text-pill social row remains");
});

test("socialGlyph: name match, aliases, hostname detection, honest fallbacks", async () => {
  const { socialGlyph } = await import("../src/lib/renderers/social-icons");
  // Typed name wins.
  assert.ok(socialGlyph("instagram", "https://x.com/nope").inner.includes("<path"), "known name → path");
  // Alias resolves.
  assert.equal(socialGlyph("twitter", "https://").label, "twitter");
  assert.ok(socialGlyph("twitter", "https://").inner.includes("<path"), "twitter → X glyph");
  // Hostname rescues a vague name.
  assert.ok(socialGlyph("me", "https://instagram.com/marisa").inner.includes("<path"), "instagram.com detected");
  // mailto → email glyph.
  assert.ok(socialGlyph("", "mailto:hi@example.com").inner.includes("<path"), "mailto → email glyph");
  // Unknown → letter badge, never a wrong brand mark.
  const weird = socialGlyph("myspaceish", "https://weird.example");
  assert.ok(weird.inner.includes("<text"), "unknown network → honest letter badge");
  assert.equal(weird.label, "myspaceish");
  // Empty everything → globe.
  assert.ok(socialGlyph("", "https://somewhere.example").inner.includes("<path"), "bare url → globe");
});

test("gradient tier: gradients render, solid anchors guard color-only positions", async () => {
  const m = fixture({ theme: "aurora" });
  const html = renderProfileHtml(m, CTX);
  assert.ok(html.includes("linear-gradient(165deg,#0b1026"), "gradient background renders");
  assert.ok(html.includes("border: 3px solid #141a3a"), "avatar ring uses the solid anchor, not the gradient");

  const card = await renderCardHtml(m, CTX);
  assert.equal(
    /linear-gradient\([^)]*linear-gradient/.test(card),
    false,
    "no gradient nested inside a gradient — the card uses the anchor",
  );
  assert.ok(card.includes("#141a3a"), "card composes with the solid anchor");

  // Solid themes are untouched: solidBg falls back to bg.
  const solid = renderProfileHtml(fixture({ theme: "mach" }), CTX);
  assert.ok(solid.includes("border: 3px solid #0b0d11"), "solid themes anchor on their own bg");
});

test("background override: canvas + page ink swap, cards stay theme-driven", () => {
  // A LIGHT solid background under a DARK theme (signal: light text on
  // dark cards) — the exact split that breaks naive implementations.
  const m = fixture({
    theme: "signal",
    background: { kind: "solid", color: "#F8FAFC" },
  });
  const html = renderProfileHtml(m, CTX);

  assert.ok(html.includes("background: #f8fafc; color: #0f172a"), "body: background canvas + DARK page ink over the light bg");
  assert.ok(html.includes("border: 3px solid #f8fafc"), "avatar ring anchors on the background, not the theme bg");
  assert.ok(html.includes("background: #1e293bcc; color: #f8fafc"), "link cards keep the THEME's dark bg + light text");
  assert.ok(html.includes(".bio { color: #0f172ab8"), "page-level sub ink follows the background");

  // Gradient background: materialized stops render, direction maps to CSS.
  const g = fixture({
    theme: "pro",
    background: {
      kind: "gradient",
      direction: "diagonal",
      stops: ["#0F172A", "#1E293B"],
      preset: "midnight",
    },
  });
  const ghtml = renderProfileHtml(g, CTX);
  assert.ok(ghtml.includes("linear-gradient(135deg,#0f172a,#1e293b)"), "diagonal gradient renders from stored stops");
  assert.ok(ghtml.includes("border: 3px solid #172033"), "ring anchors on the channel-mean of the stops");
  assert.ok(ghtml.includes("color: #f8fafc"), "dark gradient gets light page ink");

  // No background → identical to before: theme runs everything.
  const plain = renderProfileHtml(fixture({ theme: "signal" }), CTX);
  assert.ok(plain.includes("background: #0f172a; color: #f8fafc"), "absent background leaves the theme canvas untouched");
});

test("soc: icon tokens: brand SVG in the chip, raw tokens never leak", () => {
  const m = fixture({
    blocks: [
      { id: "blk_ig", type: "link", order: 0, data: { label: "My reels", url: "https://instagram.com/marisa", icon: "soc:instagram" } },
      { id: "blk_tw", type: "link", order: 1, data: { label: "Posts", url: "https://x.com/marisa", icon: "soc:twitter" } },
      { id: "blk_uk", type: "link", order: 2, data: { label: "Mystery", url: "https://weird.example", icon: "soc:notabrand" } },
      { id: "blk_em", type: "link", order: 3, data: { label: "Menu", url: "https://menu.example", icon: "✂" } },
    ],
  });
  const html = renderProfileHtml(m, CTX);

  assert.ok(/<span class="ic"><svg viewBox="0 0 24 24"[^>]*><path d="M12 2\.2/.test(html), "soc:instagram → inline instagram SVG in the icon chip");
  assert.ok(html.includes('d="M18.9 2H22'), "soc:twitter resolves through the alias to the X glyph");
  assert.equal(html.includes("soc:notabrand"), false, "unknown tokens NEVER print on the public page");
  assert.ok(html.includes('class="lk noic"'), "the unknown-token card renders iconless, honestly");
  assert.ok(html.includes('<span class="ic">✂</span>'), "text glyphs unchanged");
  assert.ok(html.includes(".ic svg"), "chip svg sizing ships with the page css");
});

test("surfaces block: chips honor toggles; head carries alternate links", () => {
  const m = fixture({
    blocks: [
      { id: "blk_sf", type: "surfaces", order: 0, data: { title: "Save & share", md: true, qr: false } },
    ],
  });
  const html = renderProfileHtml(m, CTX);

  // Human trio defaults ON (qr explicitly off here); machine surfaces opt-in.
  assert.ok(html.includes("?format=vcard") && html.includes("📇 Save contact"), "vCard chip on by default");
  assert.ok(html.includes("?format=card"), "card chip on by default");
  assert.equal(html.includes("▦ QR code"), false, "qr:false removes its chip");
  assert.ok(html.includes(".md") && html.includes("📄 Markdown"), "md:true adds the markdown chip");
  assert.equal(html.includes("〈/〉 JSON"), false, "json stays opt-in");
  assert.ok(html.includes('<h2 class="hd">Save &amp; share</h2>'), "optional title renders escaped");

  // Machine-discoverable on EVERY page, block or not: alternate links in head.
  const plain = renderProfileHtml(fixture(), CTX);
  assert.ok(plain.includes('rel="alternate" type="text/markdown"'), "md alternate link always present");
  assert.ok(plain.includes('rel="alternate" type="application/json"'), "json alternate link always present");
});

test("brand assets thread through the public page when the deployment has them", () => {
  const ctx = {
    origin: "https://links.example.com",
    brand: "OurLynx",
    brandLogo: "https://cdn.example.com/lynx.png",
    favicon: "https://cdn.example.com/lynx-fav.png",
    holoColors: ["#00C2FF", "#3A7DFF", "#7A5CFF", "#B26CFF"],
  };
  const m = fixture({
    blocks: [
      { id: "blk_gv", type: "giveaway", order: 0, data: { raffleId: "rfl_aabbccddeeff00112233", prize: "Lynx swag", closesAt: "2027-01-01T00:00:00.000Z", winners: 1 } },
    ],
  });
  const html = renderProfileHtml(m, ctx);
  assert.ok(html.includes('rel="icon" href="https://cdn.example.com/lynx-fav.png"'), "favicon per deployment");
  assert.ok(html.includes('class="blg" src="https://cdn.example.com/lynx.png"'), "logo in the footer chip");
  assert.ok(html.includes("#00C2FF, #3A7DFF, #7A5CFF, #B26CFF, #00C2FF"), "holo ring streams the brand ramp, closed loop");

  // Undressed deployments keep the defaults: ⬡ and the rainbow.
  const plain = renderProfileHtml(m, CTX);
  assert.ok(plain.includes("<b>⬡</b>"), "wordmark glyph without a logo");
  // The pop-art default: a tight hot-pink/gold/electric-blue trio,
  // NOT the old five-hue rainbow (the "clown wheel" Mark killed).
  assert.ok(plain.includes("#ec4899, #fbbf24, #3b82f6, #ec4899"), "default ring is the pop-art trio, closed loop");
  assert.equal(plain.includes("#6366f1, #22d3ee, #34d399"), false, "the rainbow wheel is gone");
  assert.equal(plain.includes("rel=\"icon\""), false, "no favicon link unless configured");
});

test("brand asset URLs: root-relative allowed, foreign/scheme injection refused", () => {
  const rel = renderProfileHtml(fixture(), {
    origin: "https://links.example.com",
    brandLogo: "/brand/lynx-mark.png",
    favicon: "/brand/lynx-favicon.png",
  });
  assert.ok(rel.includes('src="/brand/lynx-mark.png"'), "relative logo passes");
  assert.ok(rel.includes('rel="icon" href="/brand/lynx-favicon.png"'), "relative favicon passes");

  const evil = renderProfileHtml(fixture(), {
    origin: "https://links.example.com",
    brandLogo: "//evil.example/steal.png",
    favicon: "javascript:alert(1)",
  });
  assert.ok(evil.includes("<b>⬡</b>"), "protocol-relative logo refused — wordmark fallback");
  assert.equal(evil.includes('rel="icon"'), false, "scheme favicon refused entirely");
});

test("giveaway tagline: the owner's voice on the card, escaped; human default", () => {
  const gv = (data: Record<string, unknown>) =>
    renderProfileHtml(
      fixture({
        blocks: [
          { id: "blk_gv", type: "giveaway", order: 0, data: { raffleId: "rfl_aabbccddeeff00112233", prize: "Lynx swag", closesAt: "2099-01-01T00:00:00.000Z", winners: 1, ...data } },
        ],
      }),
      CTX,
    );

  // Default: plain human words — the whitepaper vocabulary is off the card.
  const plain = gv({});
  assert.ok(plain.includes("free to enter"), "human default tagline");
  assert.equal(plain.includes("provably fair"), false, "compliance poetry gone from the card");

  // The owner's words, verbatim (Marisa's ask).
  const custom = gv({ tagline: "Win a free blowout on me 💇" });
  assert.ok(custom.includes("Win a free blowout on me 💇"), "custom tagline renders");
  assert.equal(custom.includes("free to enter"), false, "custom replaces the default");

  // Hostile taglines are inert text.
  const evil = gv({ tagline: "<img src=x onerror=alert(1)>" });
  assert.equal(evil.includes("<img src=x"), false, "tagline cannot inject markup");
  assert.ok(evil.includes("&lt;img src=x"), "escaped, not silently dropped");

  // Closed cards stay human too.
  const closed = gv({ closesAt: "2020-01-01T00:00:00.000Z" });
  assert.ok(closed.includes("winner on the way"), "closed card is human");
});

test("giveaway face = theme CARD surface — readable over light custom canvases (Marisa's pink)", () => {
  // The bug, pinned: DARK theme + LIGHT custom background. solidBg()
  // tracks the background anchor, so a bare-solidBg face went pink
  // while the card ink stayed light. The face must be the theme card
  // surface (what the ink was designed for), composited over the
  // anchor so the stack stays opaque against ring bleed-through.
  const html = renderProfileHtml(
    fixture({
      background: { kind: "gradient", direction: "diagonal", stops: ["#fbd8e2", "#f6c1d0"] },
      blocks: [
        { id: "blk_gv", type: "giveaway", order: 0, data: { raffleId: "rfl_aabbccddeeff00112233", prize: "One free haircut", closesAt: "2099-01-01T00:00:00.000Z", winners: 1 } },
      ],
    }),
    CTX,
  );
  const gvw = html.slice(html.indexOf(".gvw {"), html.indexOf(".gvw:hover"));
  assert.ok(
    gvw.includes("linear-gradient(#24121899, #24121899) padding-box"),
    "face leads with the rosegold CARD color, not the canvas anchor",
  );
  assert.match(
    gvw,
    /linear-gradient\(#24121899, #24121899\) padding-box,\s*linear-gradient\(#[0-9a-fA-F]{6}/,
    "card surface composited over a solid anchor layer — opaque stack",
  );
  assert.ok(gvw.includes("conic-gradient(from var(--gvang)"), "the ring survives in the border-box layer");
});

test("gallery block: swipeable, lazy, escaped, https-only — empty renders nothing", () => {
  const gal = (images: unknown) =>
    renderProfileHtml(
      fixture({ blocks: [{ id: "blk_g", type: "gallery", order: 0, data: { images } as Record<string, unknown> }] }),
      CTX,
    );
  const html = gal([
    { url: "https://cdn.example.com/cut1.jpg", caption: "Balayage, fresh out of the chair" },
    { url: "https://cdn.example.com/cut2.jpg" },
    { url: "http://insecure.example.com/nope.jpg" },
    { url: "javascript:alert(1)" },
  ]);
  assert.ok(html.includes('class="gal"'), "gallery strip renders");
  assert.ok(html.includes('src="https://cdn.example.com/cut1.jpg"'), "https photo renders");
  assert.ok(html.includes('loading="lazy"'), "photos lazy-load");
  assert.ok(html.includes("Balayage, fresh out of the chair"), "caption renders");
  assert.equal(html.includes("insecure.example.com"), false, "http photos dropped");
  assert.equal(html.includes("javascript:"), false, "scheme injection dropped");

  const evil = gal([{ url: "https://cdn.example.com/x.jpg", caption: "<img src=x onerror=alert(1)>" }]);
  assert.equal(evil.includes("<img src=x"), false, "captions cannot inject markup");
  assert.ok(evil.includes("&lt;img src=x"), "escaped, not silently dropped");

  assert.equal(gal([]).includes('class="gal"'), false, "empty gallery renders nothing (saves never walled)");
});

test("whatsapp block: wa.me from validated digits, message encoded, junk renders nothing", () => {
  const wa = (data: Record<string, unknown>) =>
    renderProfileHtml(
      fixture({ blocks: [{ id: "blk_w", type: "whatsapp", order: 0, data }] }),
      CTX,
    );

  const html = wa({ phone: "919876543210", label: "Chat with me", message: "Hi! Booking?" });
  assert.ok(html.includes("class=\"lk wa\""), "whatsapp block renders");
  assert.ok(html.includes("Chat with me"), "custom label renders");
  // Routed through /go, so the wa.me target arrives URL-encoded inside ?to=.
  assert.ok(html.includes(encodeURIComponent("https://wa.me/919876543210")), "wa.me link built from digits");
  // encodeURIComponent leaves "!" unreserved, so the inner encoding is
  // `text=Hi!%20Booking%3F`; go() then encodes that whole string again.
  assert.ok(
    html.includes(encodeURIComponent("?text=Hi!%20Booking%3F")),
    "message is encoded, not raw",
  );
  assert.equal(html.includes("Hi! Booking?"), false, "raw message never lands in the href");

  assert.equal(wa({ phone: "" }).includes("lk wa"), false, "empty number renders nothing");
  assert.equal(wa({ phone: "012345678" }).includes("lk wa"), false, "leading zero is not E.164");
  assert.equal(wa({ phone: "123" }).includes("lk wa"), false, "too short to be a number");

  // A renderer must not trust that old documents came through today's schema.
  const dirty = wa({ phone: "+91 98765 43210", label: "x" });
  assert.ok(dirty.includes(encodeURIComponent("https://wa.me/919876543210")), "punctuation stripped, not rejected");

  const evil = wa({ phone: "919876543210", label: '<script>alert(1)</script>' });
  assert.equal(evil.includes("<script>"), false, "label cannot inject markup");
});

test("upi block: intent built from parts, no fake receipt, bad VPA renders nothing", () => {
  const upi = (data: Record<string, unknown>) =>
    renderProfileHtml(fixture({ blocks: [{ id: "blk_u", type: "upi", order: 0, data }] }), CTX);

  const html = upi({
    vpa: "aisha@okhdfcbank",
    payeeName: "Aisha Sharma",
    amount: 499,
    note: "Design kit",
    label: "Buy the kit",
  });
  assert.ok(html.includes("upi://pay?pa=aisha%40okhdfcbank"), "intent addresses the creator's own VPA");
  assert.ok(html.includes("am=499.00"), "fixed amount is two-decimal");
  assert.ok(html.includes("cu=INR"), "currency is explicit");
  assert.ok(html.includes(`tn=${encodeURIComponent("Design kit")}`), "note is encoded");
  assert.ok(html.includes("Buy the kit"), "custom label renders");
  assert.ok(html.includes("<code>aisha@okhdfcbank</code>"), "VPA printed for hand-entry fallback");

  // The honesty contract: a UPI intent has no callback, so the page must
  // never imply the money arrived. If this ever starts failing, the fix is
  // to delete the claim, not the assertion. Comments are stripped first —
  // the contract is about what a VISITOR reads, and the stylesheet's own
  // comments explain (in those words) why we make no such claim.
  const visible = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(
    /\b(paid|verified|payment received|confirmed)\b/i.test(visible),
    false,
    "no fake receipt state",
  );

  // Payer-chooses: no am= at all, rather than am=0.00 (which some apps reject).
  const open = upi({ vpa: "aisha@okhdfcbank", amount: 0 });
  assert.equal(open.includes("am="), false, "amount omitted entirely when payer chooses");

  assert.equal(upi({ vpa: "" }).includes("upi://"), false, "empty VPA renders nothing");
  assert.equal(upi({ vpa: "not-a-vpa" }).includes("upi://"), false, "malformed VPA renders nothing");
  assert.equal(
    upi({ vpa: "a@b", amount: 1 }).includes("upi://"),
    false,
    "too-short VPA rejected — a wrong payee is worse than no button",
  );

  const evil = upi({ vpa: "aisha@okhdfcbank", note: '"><script>alert(1)</script>' });
  assert.equal(evil.includes("<script>"), false, "note cannot inject markup");
});

test("custom SEO: overrides render escaped, share image upgrades the card, fallbacks hold", () => {
  const withSeo = renderProfileHtml(
    fixture({
      seo: {
        title: "Winter Park Lash & Brow — book online",
        description: "Lash artistry & brow design in Winter Park. New clients welcome.",
        image: "https://cdn.example.com/card.jpg",
      },
    }),
    CTX,
  );
  assert.ok(withSeo.includes("<title>Winter Park Lash &amp; Brow — book online</title>"), "custom title, escaped");
  assert.ok(withSeo.includes('content="Lash artistry &amp; brow design in Winter Park. New clients welcome."'), "custom description");
  assert.ok(withSeo.includes('<meta property="og:image" content="https://cdn.example.com/card.jpg"'), "share image lands");
  assert.ok(withSeo.includes('content="summary_large_image"'), "image upgrades the twitter card");

  const hostile = renderProfileHtml(
    fixture({ seo: { title: '"><script>alert(1)</script>', image: "http://insecure.example.com/x.jpg" } }),
    CTX,
  );
  assert.equal(hostile.includes("<script>alert(1)"), false, "seo strings cannot inject");
  assert.equal(hostile.includes("insecure.example.com"), false, "http share images dropped");
  assert.ok(hostile.includes('content="summary"'), "no image, plain card");

  const plain = renderProfileHtml(fixture(), CTX);
  assert.ok(plain.includes("<title>Marisa Yvette (@marisayvettehair)</title>"), "automatic title untouched");
  assert.equal(plain.includes("og:image"), false, "no share image unless set");
});

test("link labels center on the card — icon or not; the giveaway stays poster-left", () => {
  const html = renderProfileHtml(fixture(), CTX);
  assert.match(
    html,
    /\.lk > span:not\(\.ic\):not\(\.ar\) \{ flex: 1; text-align: center/,
    "iconed labels center",
  );
  assert.match(
    html,
    /\.gvw > span:not\(\.ic\):not\(\.ar\) \{ text-align: left/,
    "giveaway keeps its poster layout",
  );
});

test("the kundli porcelain theme renders a light page with readable ink", async () => {
  const html = renderProfileHtml(fixture({ theme: "kundli" }), CTX);
  assert.ok(html.includes("background: #fefefe"), "porcelain canvas");
  assert.ok(html.includes("#110e0c"), "near-black ink");
  assert.ok(html.includes("#c85c10"), "marigold accent");
  // The readability contract: the card surface must differ from the
  // canvas, or every card vanishes into a white page.
  const { THEMES } = await import("../src/lib/renderers/html");
  const k = THEMES.kundli;
  assert.notEqual(k.card.toLowerCase(), k.bg.toLowerCase(), "cards are distinguishable from the canvas");
  assert.ok(html.includes(k.card), "warm card surface reaches the page");
});
