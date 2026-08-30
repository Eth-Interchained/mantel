/**
 * Public rendering routes — where the renderer registry meets the road.
 *
 *   GET /:handle            → default renderer (html), 301 on renamed handles
 *   GET /:handle?format=id  → any registered renderer, same URL grammar
 *   GET /go/:id/:blockId    → click-tracked outbound redirect
 *
 * Every view and click lands as an append-only event document. Analytics
 * are one NQL GROUP BY away, and nothing is ever updated or deleted.
 */

import { Router } from "express";

import { track } from "./events";
import { getRenderer } from "../lib/registry";
import "../lib/renderers/html";
import "../lib/renderers/json";
import "../lib/renderers/markdown";
import "../lib/renderers/qr";
import "../lib/renderers/vcard";
import "../lib/renderers/card";
import { config } from "./config";
import { getManifest, resolveHandle } from "./identities";
import { wrap } from "./util";

export const render = Router();

function originOf(req: { protocol: string; get(h: string): string | undefined }): string {
  return config.publicOrigin || `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

/** GET /go/:identityId/:blockId?to=… — outbound click tracking. */
render.get("/go/:identityId/:blockId", (req, res) => {
  const to = String(req.query.to ?? "");
  if (!/^(https?:|mailto:|tel:)/i.test(to)) {
    res.status(400).send("bad destination");
    return;
  }
  track({
    identityId: String(req.params.identityId),
    blockId: String(req.params.blockId),
    kind: "link_click",
    source: typeof req.query.src === "string" ? req.query.src : "direct",
  });
  res.redirect(302, to);
});

/** GET /:handle — the public identity, through whichever renderer is asked for. */
render.get("/:handle", wrap(async (req, res, next) => {
  let raw = String(req.params.handle).toLowerCase();
  // /:handle.md — the URL shape LLM agents guess. Same identity, the
  // markdown renderer, no query grammar needed.
  let suffixFormat: string | null = null;
  if (raw.endsWith(".md")) {
    suffixFormat = "md";
    raw = raw.slice(0, -3);
  }
  // Anything else with a dot is a file request (favicon.ico etc.) — not a handle.
  if (raw.includes(".")) {
    next();
    return;
  }

  const resolved = await resolveHandle(raw);
  if (!resolved) {
    next();
    return;
  }
  // Renamed handle: send visitors (and old QR codes) to the new branding.
  // A .md suffix survives the rename — machine URLs redirect like any other.
  if (resolved.redirected) {
    const qs = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    res.redirect(301, `/${resolved.record.handle}${suffixFormat ? ".md" : ""}${qs}`);
    return;
  }

  const manifest = await getManifest(resolved.record.identityId);
  if (!manifest || manifest.status !== "published") {
    next();
    return;
  }

  const format = suffixFormat ?? (typeof req.query.format === "string" ? req.query.format : "html");
  const renderer = getRenderer(format);
  if (!renderer) {
    res.status(400).json({ error: `unknown renderer: ${format}` });
    return;
  }

  // Honest event semantics per surface: a human looking at the identity is
  // a profile_view; saving the contact is a vcard_download; fetching QR
  // bytes or JSON is neither — utility surfaces don't inflate analytics.
  if (format === "html" || format === "card") {
    track({
      identityId: manifest.identityId,
      kind: "profile_view",
      source:
        typeof req.query.src === "string" ? req.query.src : format === "card" ? "card" : "direct",
    });
  } else if (format === "vcard") {
    track({
      identityId: manifest.identityId,
      kind: "vcard_download",
      source: typeof req.query.src === "string" ? req.query.src : "direct",
    });
  }

  // Query params flow through as renderer options (?format=qr&type=png&download=1).
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") options[k] = v;
  }

  const out = await renderer.render(manifest, { origin: originOf(req), brand: config.brandName, brandLogo: config.brandLogoUrl || undefined, favicon: config.faviconUrl || undefined, holoColors: config.holoColors.length ? config.holoColors : undefined, options });
  res.setHeader("content-type", out.contentType);
  if (out.filename) {
    res.setHeader("content-disposition", `attachment; filename="${out.filename}"`);
  }
  // Binary bodies MUST cross Express as Buffer — res.send(Uint8Array) walks
  // the JSON path and serializes bytes as {"0":137,...}. Found live, kept fixed.
  res.send(typeof out.body === "string" ? out.body : Buffer.from(out.body));
}));
