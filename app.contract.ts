import { defineApp } from "@interchained/portal-contract";

/**
 * NEDB Links — Portal contract (schema v1)
 *
 * North Star:
 *   NEDB stores knowledge. Portal renders experiences. Links publishes identity.
 *
 * Design principle (ecosystem-wide):
 *   Engine capability equals product feature.
 *   AS OF is page history. VALID AS OF is scheduled publishing. TRACE is edit
 *   history. Provenance is trust. Immutable history is restoration. Append-only
 *   events with NQL aggregation are analytics.
 *
 * The Extension Promise (never changes):
 *   If we can build it, you can build it. Every built-in block, template,
 *   renderer, importer, exporter, and theme uses the exact same public APIs
 *   available to the community.
 */
export default defineApp({
  name: "NEDB Links",
  version: "0.1.0",
  description:
    "Identity publishing on NEDB. Claim a handle, build a structured identity, publish it everywhere: profile page, business card, QR, vCard, JSON — every surface is a renderer over one canonical Identity Manifest.",
  primaryAudience: [
    "Creators and freelancers",
    "Small businesses (salons, restaurants, studios)",
    "Developers publishing portfolios and projects",
    "Organizations, teams, schools, and nonprofits",
  ],
  goals: [
    "Claim a handle and publish a complete identity in minutes",
    "One Identity Manifest, many renderers — profile, business card, QR, vCard, JSON",
    "Every feature demonstrates a NEDB engine primitive in production",
    "Developer-friendly: blocks, templates, and renderers are public extension APIs",
  ],

  brand: {
    voice: "identity-grade: personal, precise, trustworthy — no hype, no filler",
    colors: ["#070a12", "#22d3ee", "#67e8f9", "#34d399", "#f8fafc"],
    fonts: ["Inter", "Space Grotesk", "JetBrains Mono"],
    forbiddenPhrases: [
      "magic",
      "revolutionary",
      "game-changer",
      "world-class",
      "best-in-class",
      "seamless",
      "synergy",
    ],
  },

  data: {
    identitySchema: "./src/lib/identity.ts",
    registries: "./src/lib/registry.ts",
  },

  conversion: {
    primaryGoal: "Claim a handle",
    secondaryGoal: "Publish an identity",
    successEvents: [
      "handle_claimed",
      "identity_published",
      "qr_downloaded",
      "vcard_downloaded",
      "profile_viewed",
      "link_clicked",
      "qr_scanned",
    ],
  },

  seo: {
    enabled: true,
    primaryKeyword: "link in bio identity platform",
    titleTemplate: "%s | NEDB Links",
    defaultDescription:
      "One handle, one identity, every surface. Claim your handle, publish a profile, business card, and QR code — self-hostable, versioned, and tamper-evident on the NEDB engine.",
    sitemap: true,
    robots: true,
  },
});
