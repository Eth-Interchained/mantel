/**
 * QR renderer — the physical-world handoff.
 *
 * Every QR encodes the share URL with ?src=qr, so scans land as
 * append-only events distinguishable from taps: analytics answer
 * "salon counter vs Instagram bio" with one NQL GROUP BY.
 *
 * Print decisions, made deliberately:
 *   - Error correction Q (25% recovery) — a scuffed, laminated, or
 *     sun-faded card still scans.
 *   - 4-module quiet zone — the spec minimum for reliable reads.
 *   - PNG at 1024px — crisp at business-card size on a 300dpi press.
 */

import QRCode from "qrcode";
import { defineRenderer, type RenderContext } from "../registry";
import type { IdentityManifest } from "../identity";

export function shareUrl(manifest: IdentityManifest, origin: string, source = "qr"): string {
  return `${origin}/${manifest.handle}?src=${encodeURIComponent(source)}`;
}

export interface QrStyle {
  dark: string;
  light: string;
}

/** Inline-embeddable SVG (used by the card renderer and the share kit). */
export async function buildQrSvg(
  url: string,
  style: QrStyle = { dark: "#0f172a", light: "#ffffff" },
): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 4,
    color: { dark: style.dark, light: style.light },
  });
}

/** Print-resolution PNG buffer. */
export async function buildQrPng(
  url: string,
  size = 1024,
  style: QrStyle = { dark: "#0f172a", light: "#ffffff" },
): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "Q",
    margin: 4,
    width: size,
    color: { dark: style.dark, light: style.light },
  });
  return new Uint8Array(buf);
}

export const qrRenderer = defineRenderer({
  id: "qr",
  name: "QR code",
  description:
    "The identity's share URL as a print-grade QR code (SVG or PNG), scan-source tagged for analytics.",
  consumes: ["qr", "shareable", "printable"],
  render: async (manifest: IdentityManifest, ctx: RenderContext) => {
    const url = shareUrl(manifest, ctx.origin);
    const type = ctx.options?.type === "png" ? "png" : "svg";
    const download = ctx.options?.download === "1" || ctx.options?.download === "true";

    if (type === "png") {
      const size = Math.min(Math.max(Number(ctx.options?.size) || 1024, 128), 4096);
      return {
        contentType: "image/png",
        body: await buildQrPng(url, size),
        filename: download ? `${manifest.handle}-qr.png` : undefined,
      };
    }
    return {
      contentType: "image/svg+xml; charset=utf-8",
      body: await buildQrSvg(url),
      filename: download ? `${manifest.handle}-qr.svg` : undefined,
    };
  },
});
