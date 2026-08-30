/**
 * /demo — what done looks like, rendered by the REAL pipeline.
 *
 * The homepage's job is to sell the destination, and nothing we could
 * write sells harder than the artifact itself. This route feeds a
 * fixed manifest through the exact renderer public pages use: no
 * mockup to drift out of date, no screenshot to go stale, no engine
 * writes to pollute analytics. The homepage embeds it in a phone
 * frame; it also stands alone as the shareable "see a finished page."
 *
 * The demo IS the flagship — Mint on the Avenue, Marisa's real salon
 * (Mark's call, 7/8: "why invent Maya when you can showcase Mint and
 * Marisa"). Written word-by-word like her page, as a fixed manifest —
 * deliberately NOT wired to her live identity, so the homepage embed
 * never depends on (or leaks) real account state. Signal theme — the
 * one she loves — over her pink canvas.
 */

import { Router } from "express";

import { SCHEMA_VERSION, type IdentityManifest } from "../lib/identity";
import { renderProfileHtml } from "../lib/renderers/html";
import { config } from "./config";

export const demo = Router();

/**
 * Every card routes to HER PROFILE on this instance (Mark's spec:
 * "make them all link to the mintontheavenue profile — that's her
 * profile"). The demo is a gateway: tap anything, land on the real
 * page where the real, working links live. Built per-request from the
 * origin so it's correct on every deployment — prod, probe, self-host.
 */
function demoManifest(origin: string): IdentityManifest {
  const profile = `${origin}/mintontheavenue`;
  return {
    schemaVersion: SCHEMA_VERSION,
    identityId: "idn_demo000000000000000",
    identityType: "business",
    owner: "demo",
    handle: "mintontheavenue",
    displayName: "Mint on the Avenue",
    bio: "Marisa Yvette — book your next appointment; walk-ins welcome, too.",
    theme: "signal",
    background: { kind: "gradient", direction: "diagonal", stops: ["#fbd8e2", "#f6c1d0"] },
    blocks: [
      // Labels word-by-word from the real page; brand glyphs come from
      // the renderer's icon detection on the labels' brands upstream —
      // the Book card keeps its scissors explicitly.
      { id: "blk_d1", type: "link", order: 0, data: { label: "Book an appointment", url: profile, icon: "✂" } },
      { id: "blk_d2", type: "link", order: 1, data: { label: "MintOnTheAvenue.com", url: profile } },
      { id: "blk_d3", type: "link", order: 2, data: { label: "Instagram", url: profile } },
      { id: "blk_d4", type: "link", order: 3, data: { label: "TikTok", url: profile } },
      { id: "blk_d5", type: "link", order: 4, data: { label: "Facebook", url: profile } },
      { id: "blk_d6", type: "link", order: 5, data: { label: "X.com", url: profile } },
      { id: "blk_d7", type: "link", order: 6, data: { label: "Email", url: profile } },
      { id: "blk_d8", type: "header", order: 7, data: { text: "Save & share" } },
      { id: "blk_d9", type: "surfaces", order: 8, data: { md: true, json: true } },
    ],
    capabilities: [],
    renderers: [],
    status: "published",
    publishedAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T11:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  };
}

demo.get("/demo", (req, res) => {
  const origin =
    config.publicOrigin || `${req.protocol}://${req.get("host") ?? "localhost"}`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.send(
    renderProfileHtml(demoManifest(origin), {
      origin,
      brand: config.brandName,
      brandLogo: config.brandLogoUrl || undefined,
      favicon: config.faviconUrl || undefined,
      holoColors: config.holoColors.length ? config.holoColors : undefined,
    }),
  );
});
