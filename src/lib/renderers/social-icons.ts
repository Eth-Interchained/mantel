/**
 * Social brand glyphs — inline SVG, zero-JS, self-contained.
 *
 * The RIGHT icon surfaces automatically: match the typed network name
 * first, then the URL's hostname (marisa types "me" but the link is
 * instagram.com/… → the Instagram glyph appears anyway). Anything
 * unrecognized gets an honest letter badge — a wrong brand mark is
 * worse than no brand mark.
 *
 * Paths are 24×24 viewBox, fill: currentColor, so the theme's accent
 * colors every glyph for free.
 */

const P: Record<string, string> = {
  instagram:
    "M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.9.2 2.3.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.3.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.9-.4 2.3-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.3.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.9-.2-2.3-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.3C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.9.4-2.3.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.3-.4C8.4 2.2 8.8 2.2 12 2.2m0 1.8c-3.1 0-3.5 0-4.8.1-1.1.1-1.5.2-1.8.3-.5.2-.8.4-1.1.7-.3.3-.5.6-.7 1.1-.1.3-.3.7-.3 1.8-.1 1.3-.1 1.7-.1 4.8s0 3.5.1 4.8c.1 1.1.2 1.5.3 1.8.2.5.4.8.7 1.1.3.3.6.5 1.1.7.3.1.7.3 1.8.3 1.3.1 1.7.1 4.8.1s3.5 0 4.8-.1c1.1-.1 1.5-.2 1.8-.3.5-.2.8-.4 1.1-.7.3-.3.5-.6.7-1.1.1-.3.3-.7.3-1.8.1-1.3.1-1.7.1-4.8s0-3.5-.1-4.8c-.1-1.1-.2-1.5-.3-1.8-.2-.5-.4-.8-.7-1.1-.3-.3-.6-.5-1.1-.7-.3-.1-.7-.3-1.8-.3-1.3-.1-1.7-.1-4.8-.1zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8zm0 1.8a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2zm5.1-3.1a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3z",
  x: "M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2H8l4.4 5.9L18.9 2zm-1.1 18h1.7L7.1 3.8H5.3L17.8 20z",
  tiktok:
    "M19.6 6.7a4.8 4.8 0 0 1-3.5-1.6 4.8 4.8 0 0 1-1.2-3.1h-3.2v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.2 6.2 0 0 0-.9-.1 6.1 6.1 0 1 0 6.1 6.1V8.9a8 8 0 0 0 4.7 1.5V7.2c-.7 0-1.4-.2-2-.5z",
  youtube:
    "M23 7.2s-.2-1.6-.9-2.2c-.8-.9-1.8-.9-2.2-.9C16.8 3.8 12 3.8 12 3.8s-4.8 0-7.9.3c-.4.1-1.4.1-2.2.9-.7.7-.9 2.2-.9 2.2S.8 9 .8 10.9v1.7c0 1.8.2 3.7.2 3.7s.2 1.6.9 2.2c.8.9 1.9.8 2.4.9 1.8.2 7.7.3 7.7.3s4.8 0 7.9-.3c.4-.1 1.4-.1 2.2-.9.7-.7.9-2.2.9-2.2s.2-1.8.2-3.7v-1.7c0-1.9-.2-3.7-.2-3.7zM9.7 14.9V8.4l6.1 3.3-6.1 3.2z",
  facebook:
    "M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z",
  linkedin:
    "M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.9-3-1.9 0-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3zM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM7.1 20.5H3.5V9h3.6v11.5z",
  github:
    "M12 .5A11.5 11.5 0 0 0 .5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.2 4.7 18.2 5 18.2 5c.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .4.2.7.8.6a11.5 11.5 0 0 0 7.9-10.9A11.5 11.5 0 0 0 12 .5z",
  spotify:
    "M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3c-.2.4-.7.5-1 .3-2.9-1.8-6.5-2.2-10.7-1.2-.4.1-.8-.2-.9-.6-.1-.4.2-.8.6-.9 4.6-1 8.6-.6 11.8 1.4.3.2.4.7.2 1zm1.5-3.3c-.3.4-.8.6-1.3.3-3.3-2-8.3-2.6-12.2-1.4-.5.1-1-.1-1.1-.6-.1-.5.1-1 .6-1.1 4.5-1.4 10-.7 13.8 1.6.4.2.5.8.2 1.2zm.1-3.4C15.2 8.3 8.7 8.1 5 9.2c-.6.2-1.2-.2-1.4-.7-.2-.6.2-1.2.7-1.4 4.3-1.3 11.4-1 15.9 1.6.5.3.7 1 .4 1.5-.3.5-1 .7-1.5.4z",
  twitch:
    "M4.3 1 1.6 5.6v16.2h5.5V25h3.1l3.1-3.1h4.7l6.3-6.3V1H4.3zm18 13.7-3.6 3.6h-5.7l-3.1 3.1v-3.1H5.5V3.1h16.8v11.6zM17.6 6.8h-2.1v6.3h2.1V6.8zm-5.7 0h-2.1v6.3h2.1V6.8z",
  telegram:
    "M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.9 8.2-2 9.3c-.1.7-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2-.1-.3-.4-.1l-6.9 4.3-3-.9c-.6-.2-.7-.6.1-.9l11.6-4.5c.5-.2 1 .1.9 1z",
  whatsapp:
    "M12 0A12 12 0 0 0 1.7 18L.5 23.5 6.2 22A12 12 0 1 0 12 0zm0 22a10 10 0 0 1-5.1-1.4l-.4-.2-3.4.9.9-3.3-.2-.4A10 10 0 1 1 12 22zm5.5-7.5c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.3c.2.2 2.3 3.6 5.7 5 3.4 1.4 3.4.9 4 .9.6-.1 1.8-.7 2-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.4z",
  email:
    "M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.2-8 5-8-5V6.4l8 5 8-5v1.8z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3.4a15.6 15.6 0 0 0-1.2-5.3A8 8 0 0 1 19.9 11zM12 4c.9 1.2 1.9 3.4 2.4 7H9.6C10.1 7.4 11.1 5.2 12 4zM4.1 13h3.4c.2 1.9.6 3.7 1.2 5.3A8 8 0 0 1 4.1 13zm3.4-2H4.1a8 8 0 0 1 4.6-5.3A15.6 15.6 0 0 0 7.5 11zm4.5 9c-.9-1.2-1.9-3.4-2.4-7h4.8c-.5 3.6-1.5 5.8-2.4 7zm3.3-1.7c.6-1.6 1-3.4 1.2-5.3h3.4a8 8 0 0 1-4.6 5.3z",
};

const ALIASES: Record<string, string> = {
  twitter: "x",
  "x.com": "x",
  insta: "instagram",
  ig: "instagram",
  yt: "youtube",
  gh: "github",
  mail: "email",
  gmail: "email",
  web: "globe",
  website: "globe",
  site: "globe",
};

const HOSTS: Array<[RegExp, string]> = [
  [/instagram\.com/i, "instagram"],
  [/(twitter|x)\.com/i, "x"],
  [/tiktok\.com/i, "tiktok"],
  [/(youtube\.com|youtu\.be)/i, "youtube"],
  [/facebook\.com|fb\.com/i, "facebook"],
  [/linkedin\.com/i, "linkedin"],
  [/github\.com/i, "github"],
  [/spotify\.com/i, "spotify"],
  [/twitch\.tv/i, "twitch"],
  [/t\.me|telegram\.(me|org)/i, "telegram"],
  [/wa\.me|whatsapp\.com/i, "whatsapp"],
];

/**
 * The icon-token contract: a link block whose icon is `soc:<brand>`
 * renders that brand's SVG everywhere the icon travels (the zero-JS
 * public page today; any future surface for free). The picker offers
 * exactly BRAND_IDS; the renderer resolves through brandGlyph — one
 * source of truth, the P record above.
 */
export const SOC_PREFIX = "soc:";

export const BRAND_IDS: string[] = Object.keys(P);

/** Resolve a brand id (or alias) to its 24×24 path — null if unknown,
 *  because a wrong brand mark is worse than no brand mark. */
export function brandGlyph(id: string): string | null {
  const key = id.trim().toLowerCase();
  const resolved = P[key] ? key : ALIASES[key];
  return resolved && P[resolved] ? P[resolved] : null;
}

export interface SocialGlyph {
  /** Inner SVG markup (path or text glyph) for a 24×24 viewBox. */
  inner: string;
  /** Human label for title/aria — the typed network name, prettied. */
  label: string;
}

/** Resolve the RIGHT glyph: typed name → URL hostname → letter badge. */
export function socialGlyph(network: string, url: string): SocialGlyph {
  const raw = (network || "").trim();
  const key = raw.toLowerCase();
  const resolved = P[key] ? key : ALIASES[key];
  if (resolved && P[resolved]) {
    return { inner: `<path d="${P[resolved]}"/>`, label: raw || resolved };
  }
  if (url.startsWith("mailto:")) {
    return { inner: `<path d="${P.email}"/>`, label: raw || "email" };
  }
  for (const [re, id] of HOSTS) {
    if (re.test(url)) return { inner: `<path d="${P[id]}"/>`, label: raw || id };
  }
  if (!raw) return { inner: `<path d="${P.globe}"/>`, label: "link" };
  // Honest letter badge — a wrong brand mark is worse than no brand mark.
  const letter = raw.slice(0, 1).toUpperCase().replace(/[<>&"']/g, "");
  return {
    inner: `<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">${letter}</text>`,
    label: raw,
  };
}
