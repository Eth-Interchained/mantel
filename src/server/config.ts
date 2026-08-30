/** Server configuration — real env always wins over .env (loaded in server.ts). */

/**
 * Two products, one codebase, chosen at deploy time:
 *   wallet — interchained.org: seed-phrase accounts, ITC-native.
 *            No email anywhere. (Default — today's behavior.)
 *   email  — ne-db.com: email/password/recovery. NO wallet anywhere —
 *            no seed phrases, no ITC door, no crypto vocabulary.
 * Deliberately NOT a "both" mode: mixing the two login stories is the
 * exact confusion the split exists to prevent.
 */
export type AuthMode = "wallet" | "email";

export interface LinksConfig {
  /** Express port. */
  port: number;
  /** Which account system this deployment runs. */
  authMode: AuthMode;
  /** Deployment wordmark — nav, page title, emails, public footers. */
  brandName: string;
  /** Which storefront WIREFRAME this deployment wears. "default" is the
   *  claim-first homepage every deployment has always had; "kundli" is
   *  the India storefront (Sukuna's landing). Product, auth, renderer
   *  and gates stay identical — only the marketing surface changes. */
  brandKey: string;
  /** ISO 4217 for money the storefront quotes (USD default, INR India). */
  currency: string;
  /** App theme for first-time visitors (until they pick their own). */
  defaultTheme: string;

  // ── Mail (required in email mode; Mail-in-a-Box friendly) ───────────────
  smtpHost?: string;
  smtpPort: number;
  /** true = implicit TLS (465); false = STARTTLS on 587 (MIAB default). */
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
  /** RFC 5322 From — e.g. "NEDB Links <no-reply@ne-db.com>". */
  mailFrom?: string;
  /** imgbb API key — enables avatar/logo uploads. Absent = URL-only. */
  imgbbKey?: string;
  /** Running nedbd instance. All state lives there. */
  nedbUrl: string;
  /** Database name inside nedbd. */
  nedbDb: string;
  /** Bearer token for nedbd, when the daemon is token-gated. */
  nedbToken?: string;
  /** v0.1 single-owner auth: token gating the editor and every write. */
  adminToken?: string;
  /** Public origin for share URLs and QR payloads. */
  publicOrigin?: string;
  /** AiAS gateway for the AI Profile Assistant (optional). */
  aiassistBaseUrl: string;
  aiassistApiKey?: string;

  // ── Monetization ────────────────────────────────────────────────────────
  /** Profile limits active? On when Stripe is configured or the limit is
   *  set explicitly. Self-host default: unlimited free. */
  limitEnabled: boolean;
  /** ITC node JSON-RPC for the giveaway beacon (may embed basic auth — never log). */
  itcRpcUrl: string;
  /** Deployment logo (replaces the ⬡ wordmark) and favicon — per-storefront identity. */
  brandLogoUrl: string;
  faviconUrl: string;
  /** Holographic ring stops for giveaway surfaces — validated hex, brandable per deployment. */
  holoColors: string[];
  /** Free profiles per account (default 1 when limits are on). */
  freeProfileLimit: number;
  /** Blocks per page on the free tier — unlimited for premium. */
  freeBlockLimit: number;
  /** Premium (supporter) profile ceiling — the anti-squat lever. A $5
   *  one-time payment must never buy the alphabet. 0 = uncapped (the
   *  self-host stance). Default 2 — Mark's call, 7/8: start tight,
   *  raising later is a gift. */
  premiumProfileLimit: number;
  /** Entitlements created BEFORE this instant keep the uncapped deal
   *  they bought — a paid promise is never rewritten retroactively. */
  premiumCapEpoch: string;
  /** Stripe (pay-what-you-want, one time). Absent = fiat door closed. */
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  /** PWYW floor in cents (default 100 = one dollar). */
  pwywMinCents: number;
  /** Hold-ITC door: threshold in whole ITC (default 100). */
  itcThreshold: number;
  /** ElectrumX for balance checks — Interchained fleet by default. */
  electrumHost: string;
  electrumPort: number;
  electrumTls: boolean;
}

export function loadConfig(): LinksConfig {
  const authMode: AuthMode =
    process.env.LINKS_AUTH_MODE === "email" ? "email" : "wallet";
  return {
    // LINKS_API_PORT is canonical — the generic PORT is read by many
    // tools (vite, PaaS runtimes) and port collisions/skew follow.
    port: Number(process.env.LINKS_API_PORT || process.env.PORT || 3001),
    authMode,
    brandName: (process.env.LINKS_BRAND_NAME || "NEDB Links").slice(0, 40),
    brandKey: ["default", "kundli"].includes(process.env.LINKS_BRAND_KEY || "")
      ? (process.env.LINKS_BRAND_KEY as string)
      : "default",
    currency: /^[A-Z]{3}$/.test(process.env.LINKS_CURRENCY || "")
      ? (process.env.LINKS_CURRENCY as string)
      : "USD",
    defaultTheme: ["pro", "native", "v3", "mach", "kundli"].includes(process.env.LINKS_DEFAULT_THEME || "")
      ? (process.env.LINKS_DEFAULT_THEME as string)
      : "pro",
    smtpHost: process.env.SMTP_HOST || undefined,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
    smtpUser: process.env.SMTP_USER || undefined,
    smtpPass: process.env.SMTP_PASS || undefined,
    mailFrom: process.env.MAIL_FROM || undefined,
    imgbbKey: process.env.IMGBB_API_KEY || undefined,
    nedbUrl: process.env.NEDB_URL || "http://127.0.0.1:7070",
    nedbDb: process.env.NEDB_DB || "links",
    nedbToken: process.env.NEDB_TOKEN || undefined,
    adminToken: process.env.LINKS_ADMIN_TOKEN || undefined,
    publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    aiassistBaseUrl: process.env.AIASSIST_BASE_URL || "https://api.aiassist.net",
    aiassistApiKey: process.env.AIASSIST_API_KEY || undefined,

    // Limits activate when Stripe is configured or the limit is set
    // explicitly. Self-hosters who configure neither run unlimited free.
    limitEnabled:
      Boolean(process.env.STRIPE_SECRET_KEY) ||
      process.env.LINKS_FREE_PROFILE_LIMIT !== undefined,
    freeProfileLimit: Math.max(1, Number(process.env.LINKS_FREE_PROFILE_LIMIT || 1)),
    freeBlockLimit: Math.max(1, Number(process.env.LINKS_FREE_BLOCK_LIMIT || 3)),
    premiumProfileLimit: Math.max(0, Number(process.env.LINKS_PREMIUM_PROFILE_LIMIT ?? 2)),
    premiumCapEpoch: process.env.LINKS_PREMIUM_CAP_EPOCH || "2026-07-10T00:00:00Z",
    itcRpcUrl: process.env.ITC_RPC_URL || "",
    brandLogoUrl: process.env.LINKS_BRAND_LOGO_URL || "",
    faviconUrl: process.env.LINKS_FAVICON_URL || "",
    // Hex-only, comma-separated; junk entries dropped silently.
    holoColors: (process.env.LINKS_HOLO_COLORS || "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    pwywMinCents: Math.max(50, Number(process.env.LINKS_PWYW_MIN_CENTS || 100)),
    itcThreshold: Math.max(1, Number(process.env.LINKS_ITC_THRESHOLD || 100)),
    electrumHost: process.env.ELECTRUMX_HOST || "seed.interchained.org",
    electrumPort: Number(process.env.ELECTRUMX_PORT || 50002),
    electrumTls: process.env.ELECTRUMX_TLS !== "0",
  };
}

export const config = loadConfig();

/**
 * Email mode cannot function without a mail path — verify and reset
 * flows ARE the account system. Fail fast and loud at boot rather than
 * letting signups silently dead-end. Tests inject a capture transport
 * via LINKS_MAIL_TEST=1, which skips the requirement.
 */
export function validateConfig(c: LinksConfig): string[] {
  const problems: string[] = [];
  if (c.authMode === "email" && process.env.LINKS_MAIL_TEST !== "1") {
    if (!c.smtpHost) problems.push("SMTP_HOST is required when LINKS_AUTH_MODE=email");
    if (!c.smtpUser || !c.smtpPass)
      problems.push("SMTP_USER / SMTP_PASS are required when LINKS_AUTH_MODE=email");
    if (!c.mailFrom) problems.push("MAIL_FROM is required when LINKS_AUTH_MODE=email");
    if (!c.publicOrigin)
      problems.push("PUBLIC_ORIGIN is required when LINKS_AUTH_MODE=email (links inside emails)");
  }
  return problems;
}
