/**
 * vCard renderer — "Save contact" as a first-class surface.
 *
 * vCard 3.0 (RFC 2426) for maximum importer compatibility: iOS Contacts,
 * Android, Outlook, macOS. Spec compliance is not optional decoration —
 * a contact that imports wrong is worse than no contact:
 *
 *   - CRLF line endings (the spec is explicit; bare LF breaks parsers)
 *   - Lines folded at 75 octets with CRLF + single space continuations
 *   - TEXT escaping: backslash, semicolon, comma, and newline as \n
 *   - Stable UID from the immutable identityId — re-downloading the card
 *     UPDATES the existing contact instead of duplicating it. Permanence,
 *     carried all the way into someone's phone.
 *   - REV from updatedAt, so importers know which version is newer.
 *   - Apple item-group labels (item1.URL + item1.X-ABLabel) so links show
 *     with their real names in iOS instead of "homepage".
 */

import { isFilledUrl, type IdentityManifest } from "../identity";
import { defineRenderer, type RenderContext } from "../registry";
import { shareUrl } from "./qr";

/** Escape a TEXT value per RFC 2426 §4.1 (order matters: backslash first). */
export function vEscape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n");
}

/** Fold a content line at 75 octets (UTF-8 aware), CRLF + space continuation. */
export function vFold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentOctets = 0;
  // First line gets 75 octets; continuations get 74 (the leading space costs one).
  let budget = 75;
  for (const ch of line) {
    const chOctets = encoder.encode(ch).length;
    if (currentOctets + chOctets > budget) {
      out.push(current);
      current = "";
      currentOctets = 0;
      budget = 74;
    }
    current += ch;
    currentOctets += chOctets;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

/** Best-effort N from a display name: "Marisa Yvette" → "Yvette;Marisa;;;" */
export function vName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return `;${vEscape(parts[0])};;;`;
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(" ");
  return `${vEscape(family)};${vEscape(given)};;;`;
}

/** ISO timestamp → vCard REV format (UTC, second precision). */
export function vRev(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll("-", "").replaceAll(":", "");
}

export function buildVcard(manifest: IdentityManifest, origin: string): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCARD");
  lines.push("VERSION:3.0");
  lines.push("PRODID:-//INTERCHAINED//NEDB Links//EN");
  lines.push(`UID:urn:nedb-links:${vEscape(manifest.identityId)}`);
  lines.push(`FN:${vEscape(manifest.displayName)}`);
  lines.push(`N:${vName(manifest.displayName)}`);
  lines.push(`NICKNAME:${vEscape(manifest.handle)}`);

  if (manifest.identityType === "business" || manifest.identityType === "organization") {
    lines.push(`ORG:${vEscape(manifest.displayName)}`);
  }
  if (manifest.bio) {
    lines.push(`NOTE:${vEscape(manifest.bio)}`);
  }
  if (manifest.avatar && /^https?:\/\//i.test(manifest.avatar)) {
    lines.push(`PHOTO;VALUE=URI:${manifest.avatar}`);
  }

  // The identity's own URL first — where every surface converges.
  lines.push(`URL:${shareUrl(manifest, origin, "vcard")}`);

  // Blocks → labeled URLs and social profiles.
  let item = 0;
  const sorted = [...manifest.blocks].sort((a, b) => a.order - b.order);
  for (const block of sorted) {
    const d = block.data as Record<string, unknown>;
    if (block.type === "link" && typeof d.url === "string" && isFilledUrl(d.url)) {
      if (/^tel:/i.test(d.url)) {
        lines.push(`TEL;TYPE=VOICE:${vEscape(d.url.replace(/^tel:/i, ""))}`);
        continue;
      }
      if (/^mailto:/i.test(d.url)) {
        lines.push(`EMAIL;TYPE=INTERNET:${vEscape(d.url.replace(/^mailto:/i, ""))}`);
        continue;
      }
      item += 1;
      lines.push(`item${item}.URL:${d.url}`);
      if (typeof d.label === "string" && d.label) {
        lines.push(`item${item}.X-ABLabel:${vEscape(d.label)}`);
      }
    }
    if (block.type === "social" && Array.isArray(d.links)) {
      for (const s of d.links as Array<Record<string, unknown>>) {
        if (typeof s.url === "string" && isFilledUrl(s.url) && /^https?:/i.test(s.url)) {
          const network = typeof s.network === "string" ? s.network.toLowerCase() : "web";
          lines.push(`X-SOCIALPROFILE;TYPE=${vEscape(network)}:${s.url}`);
        }
      }
    }
  }

  const rev = vRev(manifest.updatedAt);
  if (rev) lines.push(`REV:${rev}`);
  lines.push("END:VCARD");

  return lines.map(vFold).join("\r\n") + "\r\n";
}

export const vcardRenderer = defineRenderer({
  id: "vcard",
  name: "vCard",
  description:
    "The identity as an importable contact (vCard 3.0) — stable UID from the immutable identityId, so re-downloads update instead of duplicate.",
  consumes: ["exportable", "shareable"],
  render: (manifest: IdentityManifest, ctx: RenderContext) => ({
    contentType: "text/vcard; charset=utf-8",
    body: buildVcard(manifest, ctx.origin),
    filename: `${manifest.handle}.vcf`,
  }),
});
