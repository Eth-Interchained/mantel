/**
 * UPI QR — the affordance that makes paying work on a laptop.
 *
 * WHAT WENT WRONG WITHOUT IT (found by Mark, 2026-08-21)
 * `upi://pay?…` is a MOBILE-ONLY intent scheme. On a phone the OS hands
 * it to a UPI app; on a desktop nothing sensible claims it, and the
 * browser offers whatever it can find — for Mark, WhatsApp, which is a
 * legitimate registered UPI handler in India and so a perfectly correct
 * thing for the OS to suggest. Correct behaviour, useless outcome.
 *
 * No test could have caught this. A headless browser never resolves a
 * custom scheme, so every assertion I wrote could prove the href STRING
 * was right and none of them could prove clicking it does anything. The
 * lesson is narrow and worth keeping: asserting a link's shape is not
 * the same as asserting the link works.
 *
 * The fix is what every Indian payment page does — render the same
 * intent as a QR. Phones scan it, laptops show it to a phone. Together
 * with the printed VPA there are now three ways to pay and none of them
 * depend on the desktop OS knowing what `upi://` means.
 *
 * SCOPE, DELIBERATELY NARROW
 * This endpoint is not a QR generator. It resolves a real block on a
 * real published identity and encodes the SAME string that block would
 * have linked to — nothing caller-supplied ever reaches the encoder.
 */

import { Router } from "express";

import type { Block, IdentityManifest } from "../lib/identity";
import { productUpiHref, upiHref } from "../lib/renderers/html";
import { buildQrSvg } from "../lib/renderers/qr";
import { getManifest } from "./identities";
import { wrap } from "./util";

export const upiQr = Router();

/** Blocks that carry a payable UPI intent, and how to build it. */
function intentFor(block: Block): string | null {
  const d = block.data as Record<string, unknown>;
  if (block.type === "upi") return upiHref(d);
  if (block.type === "product" || block.type === "booking") return productUpiHref(d);
  return null;
}

async function payableBlock(
  identityId: string,
  blockId: string,
): Promise<{ manifest: IdentityManifest; block: Block } | null> {
  if (!/^idn_[a-f0-9]{20}$/.test(identityId)) return null;
  const manifest = await getManifest(identityId);
  if (!manifest) return null;
  const block = manifest.blocks.find((b) => b.id === blockId);
  return block && intentFor(block) ? { manifest, block } : null;
}

/**
 * GET /upi/:identityId/:blockId.svg
 *
 * Cached for an hour: the intent is derived from the manifest, so it only
 * changes when the creator edits the block — and a stale payment QR is
 * exactly the thing you don't want served, so the window stays short.
 */
upiQr.get("/upi/:identityId/:blockId.svg", wrap(async (req, res) => {
  const found = await payableBlock(String(req.params.identityId), String(req.params.blockId));
  const intent = found ? intentFor(found.block) : null;
  // Terminal 404, never next(). Falling through would hand this path to
  // the SPA catch-all, which answers 200 with an HTML shell — so an
  // <img> whose block was deleted would silently fetch a webpage instead
  // of failing visibly. Same reason the /brand mount ends in a 404.
  if (!found || !intent) {
    res.status(404).type("text/plain").send("not found");
    return;
  }
  // High error correction: these get scanned off glossy phone screens at
  // an angle, and a payment QR that needs three attempts is a lost sale.
  const svg = await buildQrSvg(intent, { dark: "#0f172a", light: "#ffffff" });
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=3600");
  res.send(svg);
}));
