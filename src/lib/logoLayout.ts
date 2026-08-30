/**
 * Logo studio layout math — one pure function used by BOTH the preview
 * stage and the canvas bake, so what you frame is exactly what uploads.
 *
 * Model: cover-fit the image into a square stage, then scale by zoom
 * around the stage center, then pan by (x, y) expressed as FRACTIONS of
 * the stage size (resolution-independent — the 240px preview and the
 * 512px export share the same state).
 */

export interface LogoLayout {
  dw: number;
  dh: number;
  dx: number;
  dy: number;
}

export function layoutCover(
  imgW: number,
  imgH: number,
  stage: number,
  zoom: number,
  x: number,
  y: number,
): LogoLayout {
  const cover = Math.max(stage / imgW, stage / imgH);
  const scale = cover * Math.max(0.2, zoom);
  const dw = imgW * scale;
  const dh = imgH * scale;
  const dx = (stage - dw) / 2 + x * stage;
  const dy = (stage - dh) / 2 + y * stage;
  return { dw, dh, dx, dy };
}

/** Clamp pan so at least a sliver of image always covers the center. */
export function clampPan(v: number, zoom: number): number {
  const limit = 0.5 * Math.max(1, zoom);
  return Math.min(limit, Math.max(-limit, v));
}

// ── Rect stages (the generalized Image Studio) ───────────────────────────────
// Same WYSIWYG contract as the square math above: ONE pure function
// drives the preview transform AND the canvas bake, at any aspect.
// Pan here is expressed in OVERFLOW halves (-1..1 per axis): -1 pins
// the image's leading edge, 0 centers, 1 pins the trailing edge —
// resolution-independent and clamped by construction.

/** Cover-fit into stageW×stageH, zoomed about center, panned in
 *  overflow units. zoom ≥ 1 (cover never underfills). */
export function layoutCoverRect(
  imgW: number,
  imgH: number,
  stageW: number,
  stageH: number,
  zoom: number,
  panX: number,
  panY: number,
): LogoLayout {
  const scale = Math.max(stageW / imgW, stageH / imgH) * Math.max(1, zoom);
  const dw = imgW * scale;
  const dh = imgH * scale;
  const ox = Math.max(0, dw - stageW);
  const oy = Math.max(0, dh - stageH);
  const px = Math.min(1, Math.max(-1, panX));
  const py = Math.min(1, Math.max(-1, panY));
  return {
    dw,
    dh,
    dx: (stageW - dw) / 2 + (px * ox) / 2,
    dy: (stageH - dh) / 2 + (py * oy) / 2,
  };
}

/** Contain-fit (letterbox) into stageW×stageH, centered — the "Fit"
 *  mode; the backdrop color owns the margins. */
export function layoutContainRect(
  imgW: number,
  imgH: number,
  stageW: number,
  stageH: number,
): LogoLayout {
  const scale = Math.min(stageW / imgW, stageH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  return { dw, dh, dx: (stageW - dw) / 2, dy: (stageH - dh) / 2 };
}

/** Overflow per axis at the current zoom — the drag handler converts
 *  pixel deltas into pan-unit deltas with this. */
export function coverOverflow(
  imgW: number,
  imgH: number,
  stageW: number,
  stageH: number,
  zoom: number,
): { ox: number; oy: number } {
  const scale = Math.max(stageW / imgW, stageH / imgH) * Math.max(1, zoom);
  return {
    ox: Math.max(0, imgW * scale - stageW),
    oy: Math.max(0, imgH * scale - stageH),
  };
}
