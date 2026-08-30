/**
 * Image uploads — the logo/avatar path, imgbb-backed.
 *
 * The client normalizes BEFORE upload (canvas: ≤512px, EXIF gone,
 * WebP/JPEG) so the server needs zero native image libraries — the
 * Windows-dev lesson, applied preemptively. The server still trusts
 * nobody: magic-byte sniffing, a hard size cap, auth, and a
 * per-principal throttle. The imgbb key lives HERE and only here;
 * browsers never see it.
 *
 *   POST /api/upload   (raw image body, content-type image/*)
 *     → { url }        (hosted image URL for manifest.avatar)
 *
 * LINKS_UPLOAD_TEST=1 skips the imgbb wire and returns a stub URL so
 * the live suite exercises the full endpoint (auth, validation,
 * throttle, response shape) without a key.
 */

import { raw, Router } from "express";

import { requireUser, authOf } from "./auth";
import { config } from "./config";
import { wrap } from "./util";

export const uploads = Router();

const MAX_BYTES = 3 * 1024 * 1024; // post-normalization images are ~50-300KB
const testMode = () => process.env.LINKS_UPLOAD_TEST === "1";

/** Magic-byte sniffing — the content-type header is a suggestion. */
export function sniffImage(buf: Buffer): "png" | "jpeg" | "webp" | "gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  return null;
}

// ── Throttle — a polite wall, not a fortress ─────────────────────────────────
// 12 uploads per principal per 10 minutes. In-memory: honest for a
// single-instance deployment; platform-wide rate limiting stays queued.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const windows = new Map<string, number[]>();

export function throttleOk(principal: string, now = Date.now()): boolean {
  const hits = (windows.get(principal) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    windows.set(principal, hits);
    return false;
  }
  hits.push(now);
  windows.set(principal, hits);
  return true;
}

async function uploadToImgbb(image: Buffer): Promise<string> {
  if (testMode()) {
    return `https://images.test/stub-${image.length}.webp`;
  }
  const body = new URLSearchParams({ image: image.toString("base64") });
  const r = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(config.imgbbKey ?? "")}`,
    { method: "POST", body },
  );
  const j = (await r.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { url?: string };
    error?: { message?: string };
  };
  if (!r.ok || !j.success || !j.data?.url) {
    throw new Error(j.error?.message ?? `image host responded ${r.status}`);
  }
  return j.data.url;
}

uploads.post(
  "/",
  requireUser,
  raw({ type: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: MAX_BYTES }),
  wrap(async (req, res) => {
    const auth = authOf(res);
    if (!auth) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!config.imgbbKey && !testMode()) {
      res.status(503).json({ error: "uploads are not configured on this instance" });
      return;
    }
    if (!throttleOk(auth.address)) {
      res.status(429).json({ error: "too many uploads — try again in a few minutes" });
      return;
    }
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "send the image bytes as the request body (content-type image/*)" });
      return;
    }
    const kind = sniffImage(body);
    if (!kind) {
      res.status(400).json({ error: "that doesn't look like an image (png/jpeg/webp/gif)" });
      return;
    }
    try {
      const url = await uploadToImgbb(body);
      res.json({ url });
    } catch (err) {
      console.error(`[links] image upload failed: ${err instanceof Error ? err.message : err}`);
      res.status(502).json({ error: "the image host didn't accept the upload — try again" });
    }
  }),
);
