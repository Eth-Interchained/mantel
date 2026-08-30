/**
 * Markdown profile renderer — the LLM-readable surface.
 *
 * `GET /:handle.md` (or ?format=md) returns the whole identity as one
 * small markdown document: YAML front matter for trivial parsing, then
 * the profile in reading order. Made for machine ingestion — agents,
 * crawlers, RAG pipelines — and perfectly pleasant for humans in a
 * terminal, too.
 *
 * Honesty rules for a machine surface:
 *   - DIRECT destination URLs, never /go/ tracking redirects — an agent
 *     quoting a link should quote the truth. (Fetching .md doesn't
 *     count as a profile_view either; analytics stay human.)
 *   - Icons are visual chrome: text glyphs and soc: tokens are omitted,
 *     never leaked as raw strings.
 *   - Unfilled template links don't render — same rule as every surface.
 *   - A formats section cross-links every registered sibling surface,
 *     so one fetch teaches a machine the whole URL grammar.
 */

import { isFilledUrl, type IdentityManifest } from "../identity";
import { defineRenderer, type RenderContext } from "../registry";

/** Escape text destined for markdown positions: link labels, headings,
 *  paragraphs. Kills bracket/paren injection and raw-HTML passthrough. */
export function mdEscape(s: unknown): string {
  return String(s ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("`", "\\`")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_");
}

/** URLs inside (…) break on parens and whitespace — encode just those. */
function mdUrl(u: string): string {
  return u.replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(" ", "%20");
}

/** YAML scalar, always double-quoted so hostile values stay values. */
function yml(s: unknown): string {
  return `"${String(s ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ")}"`;
}

export function renderProfileMarkdown(m: IdentityManifest, ctx: RenderContext): string {
  const origin = ctx.origin;
  const brand = ctx.brand ?? "NEDB Links";
  const url = `${origin}/${m.handle}`;

  const lines: string[] = [];

  // ── Front matter — the five fields a machine wants first ──────────────
  lines.push("---");
  lines.push(`name: ${yml(m.displayName)}`);
  lines.push(`handle: ${yml(m.handle)}`);
  lines.push(`type: ${yml(m.identityType)}`);
  lines.push(`url: ${yml(url)}`);
  if (m.avatar && /^https?:\/\//i.test(m.avatar)) lines.push(`avatar: ${yml(m.avatar)}`);
  lines.push(`updated: ${yml(m.updatedAt)}`);
  lines.push("---");
  lines.push("");

  lines.push(`# ${mdEscape(m.displayName)} (@${mdEscape(m.handle)})`);
  if (m.bio) {
    lines.push("");
    for (const l of m.bio.split(/\r?\n/)) lines.push(`> ${mdEscape(l)}`);
  }

  // ── Socials — identity, right under the bio, same as the page ─────────
  const socials = m.blocks
    .filter((b) => b.type === "social")
    .flatMap((b) => {
      const links = Array.isArray((b.data as Record<string, unknown>).links)
        ? ((b.data as Record<string, unknown>).links as Array<Record<string, unknown>>)
        : [];
      return links.filter((l) => isFilledUrl(l.url));
    });
  if (socials.length) {
    lines.push("");
    lines.push("## Social");
    for (const l of socials) {
      lines.push(`- [${mdEscape(l.network)}](${mdUrl(String(l.url))})`);
    }
  }

  // ── Blocks, in the owner's order ───────────────────────────────────────
  const ordered = [...m.blocks].sort((a, b) => a.order - b.order);
  let linksOpen = false;
  for (const b of ordered) {
    const d = b.data as Record<string, unknown>;
    switch (b.type) {
      case "header":
        lines.push("");
        lines.push(`## ${mdEscape(d.text)}`);
        linksOpen = true; // bullets after a header sit under it
        break;
      case "text":
        lines.push("");
        lines.push(mdEscape(d.text));
        break;
      case "link": {
        if (!isFilledUrl(d.url)) break;
        if (!linksOpen) {
          lines.push("");
          lines.push("## Links");
          linksOpen = true;
        }
        lines.push(`- [${mdEscape(d.label)}](${mdUrl(String(d.url))})`);
        break;
      }
      case "embed": {
        if (!isFilledUrl(d.url)) break;
        if (!linksOpen) {
          lines.push("");
          lines.push("## Links");
          linksOpen = true;
        }
        lines.push(`- [${mdEscape(d.title || d.url)}](${mdUrl(String(d.url))})`);
        break;
      }
      default:
        // social handled above; surfaces handled below; unknown types stay silent
        break;
    }
  }

  // ── Every sibling surface — one fetch teaches the whole grammar ───────
  lines.push("");
  lines.push("## This profile in other formats");
  lines.push(`- [Web page](${url})`);
  lines.push(`- [vCard](${url}?format=vcard)`);
  lines.push(`- [QR code](${url}?format=qr)`);
  lines.push(`- [Business card](${url}?format=card)`);
  lines.push(`- [JSON](${url}?format=json)`);
  lines.push(`- [Markdown](${url}.md)`);

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`Published with ${mdEscape(brand)} · machine-readable surface · canonical: ${url}`);
  lines.push("");

  return lines.join("\n");
}

export const markdownRenderer = defineRenderer({
  id: "md",
  name: "Markdown",
  description: "The LLM-readable profile — front matter, direct URLs, one small document.",
  consumes: ["shareable", "searchable", "exportable", "seo"],
  render: (manifest, ctx) => ({
    contentType: "text/markdown; charset=utf-8",
    body: renderProfileMarkdown(manifest, ctx),
  }),
});
