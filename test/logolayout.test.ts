/**
 * Logo studio math — the WYSIWYG guarantee: one function drives the
 * preview and the export, so framing is resolution-independent.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clampPan, layoutCover } from "../src/lib/logoLayout";

test("layoutCover: cover-fits, centers, and scales resolution-independently", () => {
  // Wide image into a square stage: height rules the cover scale.
  const l = layoutCover(2000, 1000, 240, 1, 0, 0);
  assert.equal(l.dh, 240, "short edge fills the stage");
  assert.equal(l.dw, 480, "aspect preserved");
  assert.equal(l.dy, 0, "vertically flush");
  assert.equal(l.dx, (240 - 480) / 2, "horizontally centered");

  // Zoom scales around center.
  const z = layoutCover(2000, 1000, 240, 2, 0, 0);
  assert.equal(z.dh, 480);
  assert.equal(z.dx, (240 - 960) / 2);

  // The SAME fractional pan lands proportionally on any stage size —
  // this is what makes the 240px preview honest about the 512px export.
  const a = layoutCover(1000, 1000, 240, 1.5, 0.1, -0.2);
  const b = layoutCover(1000, 1000, 512, 1.5, 0.1, -0.2);
  assert.ok(Math.abs(a.dx / 240 - b.dx / 512) < 1e-9, "x fraction identical across stages");
  assert.ok(Math.abs(a.dy / 240 - b.dy / 512) < 1e-9, "y fraction identical across stages");
});

test("clampPan: bounded, zoom widens the range", () => {
  assert.equal(clampPan(9, 1), 0.5);
  assert.equal(clampPan(-9, 1), -0.5);
  assert.equal(clampPan(0.8, 2), 0.8, "zoomed in allows wider pan");
  assert.equal(clampPan(9, 2), 1, "still bounded");
});

test("rect stages: cover fills + pans within overflow, contain letterboxes centered", async () => {
  const { layoutCoverRect, layoutContainRect, coverOverflow } = await import("../src/lib/logoLayout");

  // A wide image in a portrait stage: cover scales to fill HEIGHT.
  const c = layoutCoverRect(2000, 1000, 300, 533, 1, 0, 0);
  assert.ok(c.dh >= 533 - 0.5, "covers the stage height");
  assert.ok(c.dw >= 300, "width overflows for panning");
  assert.ok(Math.abs(c.dx + (c.dw - 300) / 2) < 0.5, "pan 0 centers the overflow");

  // Pan to the edges pins the image, never past it.
  const left = layoutCoverRect(2000, 1000, 300, 533, 1, -1, 0);
  assert.ok(Math.abs(left.dx - (300 - left.dw)) < 0.5, "pan -1 pins the trailing edge");
  const right = layoutCoverRect(2000, 1000, 300, 533, 1, 1, 0);
  assert.ok(Math.abs(right.dx) < 0.5, "pan 1 pins the leading edge");
  const over = layoutCoverRect(2000, 1000, 300, 533, 1, 5, 0);
  assert.ok(Math.abs(over.dx) < 0.5, "pan clamps at the edge");

  // Zoom expands symmetric overflow.
  const o1 = coverOverflow(2000, 1000, 300, 533, 1);
  const o2 = coverOverflow(2000, 1000, 300, 533, 2);
  assert.ok(o2.ox > o1.ox && o2.oy > o1.oy, "zoom grows the pannable range");

  // Contain: whole image visible, centered, never cropped.
  const f = layoutContainRect(2000, 1000, 300, 533);
  assert.ok(f.dw <= 300 + 0.5 && f.dh <= 533 + 0.5, "fits inside the stage");
  assert.ok(Math.abs(f.dx - (300 - f.dw) / 2) < 0.5 && Math.abs(f.dy - (533 - f.dh) / 2) < 0.5, "centered both axes");
});
