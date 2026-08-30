/**
 * Identity Manifest — the canonical contract of NEDB Links.
 *
 * The manifest is the product. Every surface (profile page, business card,
 * QR payload, vCard, JSON API, PDF, email signature, future NFC) is a
 * renderer over this one structure. Renderers come and go; the manifest
 * is permanence.
 *
 * Two identifiers, two jobs (never conflate them):
 *   - identityId: immutable. The NEDB document id. Permanence — provenance,
 *     history, backlinks, and printed QR codes hang off this.
 *   - handle: branding. A mutable, unique, human-claimed name that maps to an
 *     identityId. Renames leave a redirect so nothing ever breaks.
 *
 * A user OWNS identities (plural). Personal, business, brand, conference,
 *  anonymous demo — one owner, many identities. Identity is not the user.
 */

import type { BackgroundConfig } from "./background";

export const SCHEMA_VERSION = 1 as const;

/** Capabilities a block advertises so renderers can reason generically. */
export const CAPABILITIES = [
  "shareable",
  "qr",
  "printable",
  "searchable",
  "exportable",
  "embeddable",
  "schedulable",
  "interactive",
  "seo",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type IdentityType =
  | "personal"
  | "business"
  | "organization"
  | "project"
  | "event"
  | "demo";

export type IdentityStatus = "draft" | "published";

/** A block INSTANCE inside a manifest. Its shape is governed by the
 *  BlockDefinition registered for `type` (see registry.ts). */
export interface Block {
  /** Stable id within the manifest (blk_*). */
  id: string;
  /** Registered block type: link, header, social, embed, ... */
  type: string;
  /** Explicit ordering — the manifest owns block order. */
  order: number;
  /** Block payload, validated by the block definition's schema. */
  data: Record<string, unknown>;
}

/** MySpace energy, Links safety: a structured five-color palette the
 *  owner edits inline. Validated hex only — never raw CSS. */
export interface CustomPalette {
  bg: string;
  card: string;
  text: string;
  sub: string;
  accent: string;
  /** Curated font picks — ids into FONTS, never raw strings. */
  headingFont?: FontId;
  bodyFont?: FontId;
}

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Curated font choices — the enum IS the input; CSS stacks and Google
 * Fonts params come from THIS map only, never from user strings.
 * Ten registers, from boardroom to MySpace chaos.
 */
export const FONTS = {
  // ── Free tier — three registers that cover the basics ─────────────────
  system:         { label: "System (clean)",        tier: "free",    css: "system-ui, -apple-system, 'Segoe UI', sans-serif", google: null },
  inter:          { label: "Inter (modern)",        tier: "free",    css: "'Inter', system-ui, sans-serif",            google: "Inter:wght@400;600;800" },
  poppins:        { label: "Poppins (friendly)",    tier: "free",    css: "'Poppins', system-ui, sans-serif",          google: "Poppins:wght@400;600;700" },

  // ── Premium: modern sans ───────────────────────────────────────────────
  "space-grotesk":{ label: "Space Grotesk (tech)",  tier: "premium", css: "'Space Grotesk', system-ui, sans-serif",    google: "Space+Grotesk:wght@400;600;700" },
  montserrat:     { label: "Montserrat (bold)",     tier: "premium", css: "'Montserrat', system-ui, sans-serif",       google: "Montserrat:wght@400;600;800" },
  manrope:        { label: "Manrope (crisp)",       tier: "premium", css: "'Manrope', system-ui, sans-serif",          google: "Manrope:wght@400;600;800" },
  outfit:         { label: "Outfit (geometric)",    tier: "premium", css: "'Outfit', system-ui, sans-serif",           google: "Outfit:wght@400;600;800" },
  "instrument-serif": { label: "Instrument Serif (editorial)", tier: "premium", css: "'Instrument Serif', Georgia, serif", google: "Instrument+Serif:ital@0;1" },
  sora:           { label: "Sora (future)",         tier: "premium", css: "'Sora', system-ui, sans-serif",             google: "Sora:wght@400;600;800" },
  urbanist:       { label: "Urbanist (sleek)",      tier: "premium", css: "'Urbanist', system-ui, sans-serif",         google: "Urbanist:wght@400;600;800" },
  "plus-jakarta": { label: "Plus Jakarta (studio)", tier: "premium", css: "'Plus Jakarta Sans', system-ui, sans-serif", google: "Plus+Jakarta+Sans:wght@400;600;800" },
  "dm-sans":      { label: "DM Sans (neutral)",     tier: "premium", css: "'DM Sans', system-ui, sans-serif",          google: "DM+Sans:wght@400;500;700" },
  figtree:        { label: "Figtree (rounded)",     tier: "premium", css: "'Figtree', system-ui, sans-serif",          google: "Figtree:wght@400;600;800" },
  lexend:         { label: "Lexend (readable)",     tier: "premium", css: "'Lexend', system-ui, sans-serif",           google: "Lexend:wght@400;600;800" },

  // ── Premium: display & impact ──────────────────────────────────────────
  orbitron:       { label: "Orbitron (sci-fi)",     tier: "premium", css: "'Orbitron', system-ui, sans-serif",         google: "Orbitron:wght@500;700;900" },
  "bebas-neue":   { label: "Bebas Neue (poster)",   tier: "premium", css: "'Bebas Neue', system-ui, sans-serif",       google: "Bebas+Neue" },
  anton:          { label: "Anton (loud)",          tier: "premium", css: "'Anton', system-ui, sans-serif",            google: "Anton" },
  righteous:      { label: "Righteous (retro)",     tier: "premium", css: "'Righteous', system-ui, sans-serif",        google: "Righteous" },
  audiowide:      { label: "Audiowide (neon)",      tier: "premium", css: "'Audiowide', system-ui, sans-serif",        google: "Audiowide" },
  unbounded:      { label: "Unbounded (wide)",      tier: "premium", css: "'Unbounded', system-ui, sans-serif",        google: "Unbounded:wght@400;700;900" },
  "archivo-black":{ label: "Archivo Black (heavy)", tier: "premium", css: "'Archivo Black', system-ui, sans-serif",    google: "Archivo+Black" },
  "russo-one":    { label: "Russo One (athletic)",  tier: "premium", css: "'Russo One', system-ui, sans-serif",        google: "Russo+One" },

  // ── Premium: serif & editorial ─────────────────────────────────────────
  playfair:       { label: "Playfair (elegant)",    tier: "premium", css: "'Playfair Display', Georgia, serif",        google: "Playfair+Display:wght@400;700" },
  lora:           { label: "Lora (literary)",       tier: "premium", css: "'Lora', Georgia, serif",                    google: "Lora:wght@400;600" },
  "dm-serif":     { label: "DM Serif (editorial)",  tier: "premium", css: "'DM Serif Display', Georgia, serif",        google: "DM+Serif+Display" },
  cormorant:      { label: "Cormorant (couture)",   tier: "premium", css: "'Cormorant Garamond', Georgia, serif",      google: "Cormorant+Garamond:wght@400;600;700" },
  "libre-baskerville": { label: "Baskerville (classic)", tier: "premium", css: "'Libre Baskerville', Georgia, serif",  google: "Libre+Baskerville:wght@400;700" },
  fraunces:       { label: "Fraunces (soft serif)", tier: "premium", css: "'Fraunces', Georgia, serif",                google: "Fraunces:wght@400;600;900" },
  "crimson-pro":  { label: "Crimson Pro (book)",    tier: "premium", css: "'Crimson Pro', Georgia, serif",             google: "Crimson+Pro:wght@400;600" },
  spectral:       { label: "Spectral (essay)",      tier: "premium", css: "'Spectral', Georgia, serif",                google: "Spectral:wght@400;600" },

  // ── Premium: mono & terminal ───────────────────────────────────────────
  "jetbrains-mono":{ label: "JetBrains Mono (dev)", tier: "premium", css: "'JetBrains Mono', ui-monospace, monospace", google: "JetBrains+Mono:wght@400;600" },
  "ibm-plex-mono":{ label: "IBM Plex Mono (lab)",   tier: "premium", css: "'IBM Plex Mono', ui-monospace, monospace",  google: "IBM+Plex+Mono:wght@400;600" },
  "space-mono":   { label: "Space Mono (quirky)",   tier: "premium", css: "'Space Mono', ui-monospace, monospace",     google: "Space+Mono:wght@400;700" },
  "fira-code":    { label: "Fira Code (ligatures)", tier: "premium", css: "'Fira Code', ui-monospace, monospace",      google: "Fira+Code:wght@400;600" },

  // ── Premium: script & handmade ─────────────────────────────────────────
  caveat:         { label: "Caveat (handwritten)",  tier: "premium", css: "'Caveat', cursive",                         google: "Caveat:wght@500;700" },
  pacifico:       { label: "Pacifico (surf)",       tier: "premium", css: "'Pacifico', cursive",                       google: "Pacifico" },
  "dancing-script": { label: "Dancing Script (flow)", tier: "premium", css: "'Dancing Script', cursive",               google: "Dancing+Script:wght@500;700" },
  "permanent-marker": { label: "Marker (street)",   tier: "premium", css: "'Permanent Marker', cursive",               google: "Permanent+Marker" },
  satisfy:        { label: "Satisfy (signature)",   tier: "premium", css: "'Satisfy', cursive",                        google: "Satisfy" },
} as const;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]];

/** The free tier — everything else is a premium unlock. */
export const FREE_FONT_IDS = (Object.keys(FONTS) as FontId[]).filter(
  (id) => FONTS[id].tier === "free",
);

export function isPremiumFont(id: string): boolean {
  const f = (FONTS as Record<string, { tier: string }>)[id];
  return Boolean(f && f.tier === "premium");
}

/** The canonical object every renderer understands. */
export interface IdentityManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Immutable id — also the NEDB document id in the identities collection. */
  identityId: string;
  identityType: IdentityType;
  /** Owner reference. v0.1 self-host: the admin owner string. */
  owner: string;
  /** Current branded handle (denormalized from the handles collection). */
  handle: string;
  displayName: string;
  bio?: string;
  /** Avatar URL or data URI. */
  avatar?: string;
  /** Template that seeded this identity (who-are-you vertical). */
  template?: string;
  /** Theme id understood by HTML renderers. */
  theme?: string;
  /** Owner-customized palette — overrides theme when present. */
  themeCustom?: CustomPalette;
  /** Page background — chrome OVER the theme (canvas only; cards,
   *  accents, and type stay theme-driven). Absent = theme's own bg. */
  background?: BackgroundConfig;
  /** Opt-IN listing in the public Discover directory. Publishing a page
   *  is not consent to being indexed — this flag is. Absent = false. */
  discoverable?: boolean;
  /** Custom search & sharing (premium): overrides for the public head.
   *  Only what engines actually read — title, description, share image.
   *  Absent/empty fields fall back to displayName/bio automatically. */
  seo?: {
    title?: string;
    description?: string;
    /** https image URL — the og:image share card. */
    image?: string;
  };
  /** Ordered blocks — the body of the identity. */
  blocks: Block[];
  /** Aggregate capabilities advertised by this identity's blocks. */
  capabilities: Capability[];
  /** Renderer ids this identity opts into (empty = all registered). */
  renderers: string[];
  status: IdentityStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Handle document — id in the handles collection IS the handle string. */
export interface HandleRecord {
  handle: string;
  identityId: string;
  /** active = current branding; redirect = renamed away, 301 to successor. */
  status: "active" | "redirect";
  /** When status is redirect: the handle to send visitors to. */
  redirectTo?: string;
  claimedAt: string;
}

/** Append-only analytics event. Never updated, never deleted. */
export interface LinkEvent {
  identityId: string;
  blockId?: string;
  kind: "profile_view" | "link_click" | "qr_scan" | "vcard_download";
  /** Traffic source tag (qr, direct, social, ...). QR codes mint URLs with
   *  a source tag so scans are distinguishable from taps — analytics answer
   *  "salon counter vs Instagram bio" with one NQL GROUP BY. */
  source?: string;
  ts: string;
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/** Route names the app owns — never claimable as handles. */
export const RESERVED_HANDLES = new Set([
  "api", "go", "edit", "new", "claim", "admin", "app", "assets", "static",
  "health", "docs", "about", "settings", "login", "logout", "favicon",
  "robots", "sitemap", "index", "links", "nedb", "analytics", "identities",
  "verify", "reset", "magic", "discover", "discovery", "r", "brand",
  "demo", "fair", "terms", "qr",
]);

/** Handles are lowercase, 2-40 chars, alphanumeric plus inner hyphens. */
export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && !RESERVED_HANDLES.has(handle);
}

/**
 * A URL that actually points somewhere. Template-seeded blocks carry the
 * placeholder "https://" so users see where links belong — placeholders
 * are valid to SAVE (drafting never fights you) but renderers skip them,
 * so an unfilled link never appears on a public surface.
 */
export function isFilledUrl(u: unknown): boolean {
  return typeof u === "string" && /^(https?:\/\/\S+|mailto:\S+|tel:\S+)$/.test(u);
}

/** Valid as a stored value: empty, the placeholder, or a real URL. */
export function isStorableUrl(u: unknown): boolean {
  return u === "" || u === "https://" || u === "http://" || isFilledUrl(u);
}

export function newIdentityId(): string {
  return `idn_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function newBlockId(): string {
  return `blk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// ── Accounts, sessions, RBAC ─────────────────────────────────────────────────

/** Roles, weakest to strongest. Blockchain-simple: shared by address. */
export const ROLES = ["viewer", "editor", "owner"] as const;
export type Role = (typeof ROLES)[number];

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/** Access grant — id is `${identityId}:${address}`. caused_by chains
 *  grants to the granter's own grant: TRACE walks the authority chain. */
export interface GrantRecord {
  identityId: string;
  /** Grantee principal: itc1… (wallet mode) or eml_… (email mode). */
  address: string;
  role: Role;
  /** Principal that granted this (or "operator"). */
  grantedBy: string;
  createdAt: string;
  /** Email mode: the human-readable identity behind the eml_ principal
   *  (display only — RBAC keys on the principal). */
  email?: string;
}

/** Login challenge — short-lived, single-use. */
export interface ChallengeRecord {
  challengeId: string;
  address: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
}

/** Session — id is sha256(token); the raw token is never stored. */
export interface SessionRecord {
  tokenHash: string;
  address: string;
  createdAt: string;
  expiresAt: string;
}

/** Collections — the entire storage footprint of NEDB Links. */
export const COLLECTIONS = {
  identities: "identities",
  handles: "handles",
  events: "events",
  challenges: "challenges",
  sessions: "sessions",
  grants: "grants",
  entitlements: "entitlements",
  accounts: "accounts",
  raffles: "raffles",
  raffleEntries: "raffle_entries",
  /** Tier-2 payment credentials — the creator's OWN provider keys, sealed
   *  at rest (AES-256-GCM, owner-bound). Interchained is never merchant
   *  of record and never holds funds; see server/payments.ts. */
  payments: "payments",
  /** Tier-1 product sales: a buyer's CLAIM that they paid, pending the
   *  seller's confirmation against their own bank. Never a receipt. */
  purchases: "purchases",
} as const;

/**
 * Email-mode account (LINKS_AUTH_MODE=email — the ne-db.com product).
 * Doc id = principal (`eml_` + sha256(email)[:20]) — the same opaque
 * string that rides sessions, grants, and entitlements, so RBAC and
 * billing never learned a new trick. Wallet mode never reads this
 * collection; email mode never sees a seed phrase.
 */
export interface AccountRecord {
  principal: string;
  email: string;
  /** scrypt$N$r$p$salt_b64$key_b64 — params recorded for future upgrades. */
  passwordHash: string;
  createdAt: string;
  verifiedAt?: string;
}
