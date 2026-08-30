/**
 * Discover — the public directory over published, CONSENTING manifests.
 *
 * Not a feed, not follows, not an algorithm: an index of people who
 * chose to be found (manifest.discoverable, opt-in at the editor).
 * Server-rendered, zero client JS, deployment-branded — the directory
 * belongs to the storefront (ourlynx's Discover ≠ interchained's),
 * while every card is still just a projection of a manifest.
 *
 * Card links carry ?src=discover, so the existing analytics GROUP BY
 * picks Discover up as a traffic source with zero new tracking code.
 */

import { esc, safeUrl } from "./renderers/html";
import type { IdentityManifest, IdentityType } from "./identity";

export interface DirectoryEntry {
  handle: string;
  displayName: string;
  bio?: string;
  avatar?: string;
  identityType: IdentityType;
  publishedAt?: string;
}

/** The SAFE projection — everything public, nothing else. No owner,
 *  no principal, no email-shaped anything. */
export function toDirectoryEntry(m: IdentityManifest): DirectoryEntry {
  return {
    handle: m.handle,
    displayName: m.displayName,
    bio: m.bio,
    avatar: m.avatar,
    identityType: m.identityType,
    publishedAt: m.publishedAt,
  };
}

/** Listable = published AND explicitly opted in. */
export function isDiscoverable(m: IdentityManifest): boolean {
  return m.status === "published" && m.discoverable === true;
}

/** Newest first; q matches handle/name/bio (case-insensitive substring);
 *  type filters exactly. Pure — the engine query stays minimal. */
export function filterEntries(
  entries: DirectoryEntry[],
  q?: string,
  type?: string,
): DirectoryEntry[] {
  const needle = (q ?? "").trim().toLowerCase();
  return entries
    .filter((e) => (type ? e.identityType === type : true))
    .filter((e) =>
      needle
        ? e.handle.toLowerCase().includes(needle) ||
          e.displayName.toLowerCase().includes(needle) ||
          (e.bio ?? "").toLowerCase().includes(needle)
        : true,
    )
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

const TYPES: Array<[IdentityType | "", string]> = [
  ["", "Everyone"],
  ["personal", "People"],
  ["business", "Businesses"],
  ["organization", "Organizations"],
  ["project", "Projects"],
  ["event", "Events"],
];

function card(e: DirectoryEntry, origin: string): string {
  const url = `${origin}/${esc(e.handle)}?src=discover`;
  const avatar =
    e.avatar && /^https?:\/\//i.test(e.avatar)
      ? `<img class="av" src="${esc(safeUrl(e.avatar))}" alt="" loading="lazy" />`
      : `<span class="av avf">${esc(e.displayName.slice(0, 1).toUpperCase())}</span>`;
  return `<a class="pc" href="${url}">
  ${avatar}
  <span class="meta">
    <b>${esc(e.displayName)}</b>
    <span class="hn">@${esc(e.handle)}</span>
    ${e.bio ? `<span class="bio">${esc(e.bio)}</span>` : ""}
  </span>
  <span class="ty">${esc(e.identityType)}</span>
</a>`;
}

export function renderDirectoryHtml(
  entries: DirectoryEntry[],
  ctx: { origin: string; brand?: string; q?: string; type?: string },
): string {
  const brand = esc(ctx.brand ?? "NEDB Links");
  const q = ctx.q ?? "";
  const type = ctx.type ?? "";
  const chips = TYPES.map(([t, label]) => {
    const href = `${ctx.origin}/discover${t ? `?type=${t}` : ""}${q && t ? `&q=${encodeURIComponent(q)}` : q ? `?q=${encodeURIComponent(q)}` : ""}`;
    return `<a class="ch${type === t ? " on" : ""}" href="${esc(href)}">${label}</a>`;
  }).join("");
  const cards = entries.map((e) => card(e, ctx.origin)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Discover · ${brand}</title>
<meta name="description" content="Browse people, businesses, and projects publishing with ${brand}." />
<link rel="canonical" href="${esc(ctx.origin)}/discover" />
<style>
  * { margin: 0; box-sizing: border-box; }
  body { background: #070a12; color: #f8fafc; font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
         min-height: 100dvh; overflow-x: clip; }
  body::before { content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background: radial-gradient(60% 34% at 50% -4%, #6366f124, transparent 70%),
                radial-gradient(42% 26% at 82% 8%, #22d3ee10, transparent 70%); }
  main { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; padding: 48px 22px 72px; }
  h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  .sub { color: #94a3b8; margin-top: 8px; font-size: 15px; }
  form { margin-top: 22px; display: flex; gap: 8px; }
  input[name=q] { flex: 1; min-width: 0; background: #11162299; color: #f8fafc; font-size: 15px;
    border: 1px solid #ffffff1f; border-radius: 12px; padding: 12px 16px; outline: none;
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  input[name=q]:focus { border-color: #818cf8aa; }
  form button { background: #6366f1; color: #fff; font-weight: 700; font-size: 14px;
    border: 0; border-radius: 12px; padding: 12px 20px; cursor: pointer; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .ch { color: #94a3b8; text-decoration: none; font-size: 12.5px; font-weight: 600;
    border: 1px solid #ffffff1a; border-radius: 999px; padding: 6px 13px; transition: color .15s, border-color .15s; }
  .ch:hover { color: #f8fafc; border-color: #818cf877; }
  .ch.on { color: #eef2ff; background: #6366f126; border-color: #818cf8aa; }
  .grid { margin-top: 26px; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .pc { display: flex; align-items: center; gap: 13px; text-decoration: none; color: #f8fafc;
    background: #11162299; border: 1px solid #ffffff14; border-radius: 18px; padding: 15px 16px;
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    animation: rise .5s ease both; transition: transform .15s ease, border-color .15s ease; position: relative; min-width: 0; }
  .pc:hover { transform: translateY(-2px); border-color: #818cf877; }
  .pc:nth-child(2) { animation-delay: .05s } .pc:nth-child(3) { animation-delay: .1s }
  .pc:nth-child(4) { animation-delay: .15s } .pc:nth-child(n+5) { animation-delay: .2s }
  .av { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex: none;
    border: 2px solid #818cf855; background: #1e1b4b; }
  .avf { display: inline-flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; color: #a5b4fc; }
  .meta { min-width: 0; display: grid; gap: 1px; }
  .meta b { font-size: 15.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hn { color: #818cf8; font-size: 12.5px; font-weight: 600; }
  .bio { color: #94a3b8; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ty { position: absolute; top: 10px; right: 12px; color: #64748b; font-size: 10px;
    text-transform: uppercase; letter-spacing: .1em; font-weight: 700; }
  .empty { margin-top: 40px; color: #94a3b8; text-align: center; }
  .empty a { color: #a5b4fc; }
  footer { margin-top: 56px; text-align: center; }
  footer a { color: #94a3b8; font-size: 12px; text-decoration: none;
    border: 1px solid #ffffff14; border-radius: 999px; padding: 7px 14px; }
  footer a b { color: #818cf8; }
  @media (prefers-reduced-motion: reduce) { .pc { animation: none; transition: none; } }
</style>
</head>
<body>
<main>
  <h1>Discover</h1>
  <p class="sub">People, businesses, and projects publishing with ${brand} — everyone here chose to be listed.</p>
  <form method="get" action="/discover">
    <input name="q" value="${esc(q)}" placeholder="Search names, handles, bios…" autocomplete="off" />
    ${type ? `<input type="hidden" name="type" value="${esc(type)}" />` : ""}
    <button>Search</button>
  </form>
  <div class="chips">${chips}</div>
  ${
    entries.length
      ? `<div class="grid">\n${cards}\n</div>`
      : `<p class="empty">${
          q || type
            ? "No profiles match — try a broader search."
            : `Nobody's listed yet. <a href="${esc(ctx.origin)}/">Claim a handle</a>, publish, and flip on “Listed in Discover” to be first.`
        }</p>`
  }
  <footer><a href="${esc(ctx.origin)}/"><b>⬡</b> published with ${brand}</a></footer>
</main>
</body>
</html>`;
}
