/**
 * Client-side image normalization + upload.
 *
 * The browser does the heavy lifting BEFORE bytes travel: draw to a
 * canvas capped at 512px (EXIF orientation honored and then discarded
 * — privacy by flattening), encode WebP at q0.85 (browsers without
 * WebP encoding fall back to PNG automatically via toBlob). The server
 * validates magic bytes and forwards to the image host; the API key
 * never exists in this bundle.
 *
 * Animated GIFs flatten to their first frame — an avatar is a face,
 * not a film.
 */

import { adminHeaders } from "./api";

const MAX_EDGE = 512;

/** POST a ready blob to /api/upload → hosted URL. */
export async function uploadImageBlob(blob: Blob): Promise<string> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": blob.type || "image/webp", ...adminHeaders() },
    body: blob,
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !j.url) {
    throw new Error(j.error ?? "upload failed");
  }
  return j.url;
}

export async function normalizeAndUpload(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(
    () => createImageBitmap(file),
  );
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable in this browser");
    ctx.drawImage(bmp, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("could not encode the image"))),
        "image/webp",
        0.85,
      ),
    );

    return await uploadImageBlob(blob);
  } finally {
    bmp.close?.();
  }
}
