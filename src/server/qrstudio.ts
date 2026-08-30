/**
 * QR Studio — the physical world, branded.
 *
 * Free keeps what free was promised: the default profile QR (the
 * ledger says "print-grade QR" in the free column, and we don't
 * rewrite promises). Premium buys the STUDIO around it: brand colors,
 * per-link codes, and print flyers.
 *
 * Per-block codes encode the click-tracked /go URL with src=qr, so a
 * counter scan lands in analytics as a link_click from the qr source —
 * "which sticker works" becomes one GROUP BY, same as profile scans.
 *
 * Scannability is enforced, not suggested: custom colors must keep a
 * dark-on-light polarity and real contrast, or the request is refused
 * with friendly words. A QR that doesn't scan is a support ticket with
 * extra steps.
 */

import { Router } from "express";

import { buildQrPng, buildQrSvg, shareUrl } from "../lib/renderers/qr";
import { authOf, requireUser } from "./auth";
import { pageUnlimited } from "./billing";
import { config } from "./config";
import { hasRole } from "./grants";
import { getManifest } from "./identities";
import { wrap } from "./util";

export const qrStudio = Router({ mergeParams: true });
export const qrFlyer = Router();

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_FG = "#0f172a";
const DEFAULT_BG = "#ffffff";

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** Scanners want dark modules on a light field — ratio AND polarity.
 *  Exported for unit tests. */
export function qrScannable(fg: string, bg: string): boolean {
  const lf = luminance(fg);
  const lb = luminance(bg);
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  return ratio >= 3 && lf < lb;
}

function originOf(req: { protocol: string; get(h: string): string | undefined }): string {
  return config.publicOrigin || `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

// Premium here follows the PAGE (its owners) — pageUnlimited in
// billing.ts is the one implementation, shared with the editor gates
// and the sharing gate. (This file's original ownerIsPremium was the
// prototype; consolidated 7/9.)

/**
 * GET /api/identities/:id/qr — the studio's one endpoint.
 *   target: "profile" (default) or a block id
 *   format: png (default) | svg · size: 128..4096 (png)
 *   fg/bg:  #rrggbb (custom colors are premium) · download=1 for attachment
 */
qrStudio.get("/", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const identityId = String((req.params as Record<string, string>).id ?? "");
  if (!(await hasRole(identityId, auth, "viewer"))) {
    res.status(403).json({ error: "viewer role required" });
    return;
  }
  const manifest = await getManifest(identityId);
  if (!manifest) {
    res.status(404).json({ error: "identity not found" });
    return;
  }

  const target = String(req.query.target ?? "profile");
  const format = req.query.format === "svg" ? "svg" : "png";
  const fg = String(req.query.fg ?? DEFAULT_FG);
  const bg = String(req.query.bg ?? DEFAULT_BG);
  const download = req.query.download === "1";

  if (!HEX.test(fg) || !HEX.test(bg)) {
    res.status(400).json({ error: "colors must be #rrggbb hex" });
    return;
  }
  if (!qrScannable(fg, bg)) {
    res.status(400).json({
      error: "those colors won't scan — keep the code clearly darker than its background",
    });
    return;
  }

  const styled = fg.toLowerCase() !== DEFAULT_FG || bg.toLowerCase() !== DEFAULT_BG;
  if ((styled || target !== "profile") && config.limitEnabled && !auth.isOperator) {
    // The studio acts on a PAGE — its owners' premium is what counts,
    // so a free editor on a premium page mints branded codes too.
    if (!(await pageUnlimited(identityId))) {
      res.status(403).json({
        error: "branded and per-link QR codes are a premium unlock — go Premium to own the counter",
        code: "premium_required",
      });
      return;
    }
  }

  const origin = originOf(req);
  let url: string;
  let stem: string;
  if (target === "profile") {
    url = shareUrl(manifest, origin);
    stem = manifest.handle;
  } else {
    const blk = manifest.blocks.find((b) => b.id === target);
    if (!blk) {
      res.status(404).json({ error: "block not found on this page" });
      return;
    }
    const u = (blk.data as Record<string, unknown>).url;
    if (typeof u !== "string" || !/^(https?:|mailto:|tel:)/i.test(u)) {
      res.status(400).json({ error: "that block has no linkable URL" });
      return;
    }
    // The click-tracked redirect — scans land as link_click / src=qr.
    url = `${origin}/go/${encodeURIComponent(identityId)}/${encodeURIComponent(blk.id)}?to=${encodeURIComponent(u)}&src=qr`;
    const label = (blk.data as Record<string, unknown>).label;
    stem = `${manifest.handle}-${String(typeof label === "string" && label ? label : blk.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)}`;
  }

  const style = { dark: fg, light: bg };
  if (format === "svg") {
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    if (download) res.setHeader("content-disposition", `attachment; filename="${stem}-qr.svg"`);
    res.send(await buildQrSvg(url, style));
    return;
  }
  const size = Math.min(Math.max(Number(req.query.size) || 1024, 128), 4096);
  res.setHeader("content-type", "image/png");
  if (download) res.setHeader("content-disposition", `attachment; filename="${stem}-qr.png"`);
  res.send(Buffer.from(await buildQrPng(url, size, style)));
}));

/**
 * GET /qr/flyer/:id — a print-ready sheet, zero JS. Opens in a plain
 * tab (Cmd/Ctrl+P → done); only published pages, only public data.
 * Premium is the OWNER'S — flyers are part of the studio.
 */
qrFlyer.get("/qr/flyer/:id", wrap(async (req, res, next) => {
  const manifest = await getManifest(String(req.params.id));
  if (!manifest || manifest.status !== "published") {
    next();
    return;
  }
  if (!(await pageUnlimited(manifest.identityId))) {
    res.status(403).setHeader("content-type", "text/html; charset=utf-8");
    res.send("<!doctype html><meta charset=\"utf-8\"><title>Premium</title><body style=\"font:16px system-ui;padding:40px;text-align:center\"><h1>Flyers are a premium unlock</h1><p>The QR studio — brand colors, per-link codes, print flyers — comes with Premium.</p>");
    return;
  }
  let fg = String(req.query.fg ?? DEFAULT_FG);
  let bg = String(req.query.bg ?? DEFAULT_BG);
  if (!HEX.test(fg) || !HEX.test(bg) || !qrScannable(fg, bg)) {
    fg = DEFAULT_FG;
    bg = DEFAULT_BG;
  }
  const origin = originOf(req);
  const url = shareUrl(manifest, origin);
  const svg = await buildQrSvg(url, { dark: fg, light: bg });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>QR flyer — ${esc(manifest.displayName)}</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
         background: #f1f5f9; color: #0f172a; display: flex; justify-content: center; padding: 24px; }
  .sheet { background: #ffffff; width: 100%; max-width: 720px; border-radius: 18px;
           padding: 64px 48px; text-align: center;
           box-shadow: 0 12px 40px rgb(0 0 0 / 0.12); }
  h1 { font-size: 34px; letter-spacing: -0.02em; }
  .hn { color: #475569; font-weight: 600; margin-top: 4px; }
  .qr { width: 340px; max-width: 80%; margin: 36px auto 0; }
  .qr svg { width: 100%; height: auto; display: block; }
  .cta { font-size: 20px; font-weight: 700; margin-top: 28px; }
  .url { font-family: ui-monospace, monospace; color: #475569; font-size: 14px; margin-top: 8px; }
  .hint { color: #94a3b8; font-size: 12.5px; margin-top: 40px; }
  footer { color: #94a3b8; font-size: 12px; margin-top: 18px; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; min-height: 100vh;
             display: flex; flex-direction: column; justify-content: center; }
    .hint { display: none; }
  }
</style>
</head>
<body>
<div class="sheet">
  <h1>${esc(manifest.displayName)}</h1>
  <div class="hn">@${esc(manifest.handle)}</div>
  <div class="qr">${svg}</div>
  <p class="cta">Scan to see everything</p>
  <p class="url">${esc(url.replace(/^https?:\/\//, "").replace(/\?.*$/, ""))}</p>
  <p class="hint">Print this page (Cmd/Ctrl+P) — it's already laid out for paper.</p>
  <footer>${esc(config.brandName)}</footer>
</div>
</body>
</html>`);
}));
