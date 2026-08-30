/**
 * Fit suite — the honesty guarantees.
 *
 * mantel's whole claim is that its VRAM answers are not invented. These tests
 * exist to make that claim break loudly if anyone ever "improves" fit.ts by
 * adding a fallback estimate.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROFILES,
  customProfile,
  fitAcrossProfiles,
  fitModel,
  fitQuant,
  profileById,
} from "../src/server/fit";

const rtx3090 = profileById("rtx-3090");
assert.ok(rtx3090, "rtx-3090 is a reference profile");

test("a quant with no measured VRAM figure is unknown, never estimated", () => {
  const f = fitQuant({ name: "Q4_K_M", fileGib: 18.5, minVramGib: null }, rtx3090);
  assert.equal(f.status, "unknown");
  assert.equal(f.minVramGib, null);
  assert.equal(f.headroomGib, null);
  // The reason must say WHY, because a bare "unknown" badge teaches nothing.
  assert.match(f.reason, /NOT a substitute/);
});

test("file size is never used as a VRAM proxy", () => {
  // 18.5 GiB of weights would "fit" in 23 GiB available if you (wrongly) used
  // file size as the requirement. The real footprint is higher and unknown, so
  // the verdict must NOT be "fits".
  const f = fitQuant({ name: "Q4_K_M", fileGib: 18.5, minVramGib: null }, rtx3090);
  assert.notEqual(f.status, "fits");
  assert.notEqual(f.status, "tight");
});

test("a measured quant that fits reports real headroom", () => {
  const f = fitQuant({ name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 }, rtx3090);
  assert.equal(f.status, "fits");
  // 24 GiB card - 1 GiB reserve - 20 GiB model = 3 GiB
  assert.equal(f.headroomGib, 3);
});

test("a quant needing more than the card has is too-big, with the shortfall named", () => {
  const f = fitQuant({ name: "Q8_0", fileGib: 34, minVramGib: 36 }, rtx3090);
  assert.equal(f.status, "too-big");
  assert.equal(f.headroomGib, -13);
  assert.match(f.reason, /Short by 13 GiB/);
});

test("a quant using over 90% of available memory is tight, not fits", () => {
  // 23 GiB available; 21.5 / 23 = 93%.
  const f = fitQuant({ name: "Q5_K_M", fileGib: 20, minVramGib: 21.5 }, rtx3090);
  assert.equal(f.status, "tight");
  assert.match(f.reason, /only 1.5 GiB spare/);
});

test("the reserve is subtracted — a model exactly the card's size does not fit", () => {
  const f = fitQuant({ name: "FP16", fileGib: 24, minVramGib: 24 }, rtx3090);
  assert.equal(f.status, "too-big", "24 GiB does not fit a 24 GiB card once reserve is taken");
});

test("model verdict is the best quant's verdict", () => {
  const report = fitModel(
    [
      { name: "FP16", fileGib: 64, minVramGib: 70 }, // too big
      { name: "Q8_0", fileGib: 34, minVramGib: 36 }, // too big
      { name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 }, // fits
    ],
    rtx3090,
  );
  assert.equal(report.best, "fits");
  assert.equal(report.bestQuant, "Q4_K_M");
  assert.equal(report.unmeasured, 0);
});

test("all-unmeasured quants yield an unknown verdict, not a reassuring one", () => {
  const report = fitModel(
    [
      { name: "Q4_K_M", fileGib: 18.5, minVramGib: null },
      { name: "Q8_0", fileGib: 34, minVramGib: null },
    ],
    rtx3090,
  );
  assert.equal(report.best, "unknown");
  assert.equal(report.bestQuant, null);
  assert.equal(report.unmeasured, 2, "the count of unknowns is surfaced, not hidden");
});

test("a mix reports the best real verdict AND the unmeasured count", () => {
  const report = fitModel(
    [
      { name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 },
      { name: "Q8_0", fileGib: 34, minVramGib: null },
    ],
    rtx3090,
  );
  assert.equal(report.best, "fits");
  assert.equal(report.unmeasured, 1, "one unknown remains visible behind a fits badge");
});

test("a model with no quant data at all is unknown with zero quants", () => {
  const report = fitModel([], rtx3090);
  assert.equal(report.best, "unknown");
  assert.equal(report.quants.length, 0);
  assert.equal(report.unmeasured, 0);
});

test("fitAcrossProfiles covers every reference profile", () => {
  const reports = fitAcrossProfiles([{ name: "Q4_K_M", fileGib: 18.5, minVramGib: 20 }]);
  assert.equal(reports.length, PROFILES.length);
  const big = reports.find((r) => r.profile.id === "m3-ultra-192");
  const small = reports.find((r) => r.profile.id === "rtx-3060-12");
  assert.equal(big?.best, "fits");
  assert.equal(small?.best, "too-big", "a 20 GiB model does not fit a 12 GiB card");
});

test("customProfile accepts a plausible VRAM figure and rejects nonsense", () => {
  assert.equal(customProfile(20)?.vramGib, 20);
  assert.equal(customProfile(0), null);
  assert.equal(customProfile(-8), null);
  assert.equal(customProfile(99_999), null);
  assert.equal(customProfile(Number.NaN), null);
});

test("profileById returns null for an unknown id rather than a default", () => {
  assert.equal(profileById("nope"), null);
  assert.ok(profileById("a6000-48"));
});
