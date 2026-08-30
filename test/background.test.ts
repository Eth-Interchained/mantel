/**
 * Background math — CSS generation, anchor color, and the readability
 * guarantee. No taste in here, only WCAG arithmetic: page ink is picked
 * by contrast ratio, so any gradient a user builds stays legible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BG_HEX_RE,
  BG_PRESETS,
  anchorOf,
  backgroundSchema,
  bgCss,
  pageInkOn,
  presetBackground,
  relativeLuminance,
} from "../src/lib/background";

test("bgCss: solid + every gradient direction, normalized lowercase", () => {
  assert.equal(bgCss({ kind: "solid", color: "#F8FAFC" }), "#f8fafc", "solid lowercases");

  const stops = ["#0F172A", "#1E293B"];
  assert.equal(
    bgCss({ kind: "gradient", direction: "vertical", stops }),
    "linear-gradient(180deg,#0f172a,#1e293b)",
  );
  assert.equal(
    bgCss({ kind: "gradient", direction: "horizontal", stops }),
    "linear-gradient(90deg,#0f172a,#1e293b)",
  );
  assert.equal(
    bgCss({ kind: "gradient", direction: "diagonal", stops }),
    "linear-gradient(135deg,#0f172a,#1e293b)",
  );
  assert.equal(
    bgCss({ kind: "gradient", direction: "radial", stops }),
    "radial-gradient(120% 120% at 50% 0%,#0f172a,#1e293b)",
  );

  // Three stops join evenly — CSS spaces them itself.
  assert.equal(
    bgCss({ kind: "gradient", direction: "vertical", stops: ["#FF6B6B", "#F97316", "#FBBF24"] }),
    "linear-gradient(180deg,#ff6b6b,#f97316,#fbbf24)",
  );
});

test("anchorOf: solid passthrough; gradient = channel-wise mean of stops", () => {
  assert.equal(anchorOf({ kind: "solid", color: "#ABCDEF" }), "#abcdef");
  // Black + white average to mid-gray: (0+255)/2 = 127.5 → 128 = 0x80.
  assert.equal(
    anchorOf({ kind: "gradient", direction: "vertical", stops: ["#000000", "#FFFFFF"] }),
    "#808080",
  );
  // Midnight: (0F,1E)→17, (17,29)→20, (2A,3B)→33 (rounded means).
  assert.equal(
    anchorOf({ kind: "gradient", direction: "vertical", stops: ["#0F172A", "#1E293B"] }),
    "#172033",
  );
});

test("pageInkOn: WCAG contrast picks the ink — light bg → dark ink, dark bg → light ink", () => {
  assert.equal(pageInkOn("#ffffff").text, "#0f172a", "white canvas → dark ink");
  assert.equal(pageInkOn("#0f172a").text, "#f8fafc", "midnight canvas → light ink");
  assert.equal(pageInkOn("#fdf2f8").text, "#0f172a", "pastel canvas → dark ink");
  // Sub ink is the text ink at reduced alpha — harmonious over gradients.
  assert.equal(pageInkOn("#0f172a").sub, "#f8fafccc");
  assert.equal(pageInkOn("#ffffff").sub, "#0f172ab8");
  // Luminance sanity: monotone endpoints.
  assert.ok(relativeLuminance("#000000") === 0 && relativeLuminance("#ffffff") === 1);
});

test("presets: five cards, valid hex stops, unique ids, readable ink", () => {
  assert.equal(BG_PRESETS.length, 5, "midnight, sunset, aurora, lavender, forest");
  const ids = new Set(BG_PRESETS.map((p) => p.id));
  assert.equal(ids.size, BG_PRESETS.length, "preset ids are unique");
  for (const p of BG_PRESETS) {
    for (const s of p.stops) assert.match(s, BG_HEX_RE, `${p.id}: ${s} is #rrggbb`);
    const bg = presetBackground(p);
    assert.equal(bg.preset, p.id, "materialized config remembers its card");
    assert.ok(backgroundSchema.safeParse(bg).success, `${p.id} passes its own schema`);
    // Every preset must resolve to SOME ink — the guarantee is total.
    const ink = pageInkOn(anchorOf(bg));
    assert.ok(ink.text === "#0f172a" || ink.text === "#f8fafc");
  }
  // The dark presets read dark: light ink.
  assert.equal(pageInkOn(anchorOf(presetBackground(BG_PRESETS[0]))).text, "#f8fafc", "midnight → light ink");
});

test("backgroundSchema: hex-only stops, enum-only direction — CSS injection has no door", () => {
  const ok = backgroundSchema.safeParse({
    kind: "gradient",
    direction: "diagonal",
    stops: ["#2563EB", "#06B6D4"],
  });
  assert.ok(ok.success, "valid gradient parses");
  assert.ok(backgroundSchema.safeParse({ kind: "solid", color: "#0F172A" }).success);

  const bad = [
    { kind: "solid", color: "red" },
    { kind: "solid", color: "#0F172A;} body{background:url(evil)" },
    { kind: "gradient", direction: "diagonal", stops: ["#2563EB", "url(javascript:x)"] },
    { kind: "gradient", direction: "spiral", stops: ["#2563EB", "#06B6D4"] },
    { kind: "gradient", direction: "vertical", stops: ["#2563EB"] },
    { kind: "gradient", direction: "vertical", stops: ["#111111", "#222222", "#333333", "#444444", "#555555"] },
    { kind: "image", url: "https://x.example/a.png" },
  ];
  for (const b of bad) {
    assert.equal(backgroundSchema.safeParse(b).success, false, `rejected: ${JSON.stringify(b)}`);
  }
});

test("image backgrounds: clean https only, scrim stack, anchor contract", () => {
  // Schema: the URL regex IS the CSS-injection defense.
  const good = backgroundSchema.safeParse({ kind: "image", url: "https://cdn.example.com/photo.webp", anchor: "#0B0F19", dim: 40 });
  assert.equal(good.success, true, "clean https image accepted");
  for (const url of [
    "http://insecure.example.com/x.jpg",
    'https://x.example/a").png',
    "https://x.example/a'b.png",
    "https://x.example/a b.png",
    "javascript:alert(1)",
    `https://x.example/${"a".repeat(500)}`,
  ]) {
    assert.equal(
      backgroundSchema.safeParse({ kind: "image", url, anchor: "#0b0f19" }).success,
      false,
      `rejected: ${url.slice(0, 40)}`,
    );
  }

  // bgCss: scrim over photo over anchor — one value, dim as alpha hex.
  const css = bgCss({ kind: "image", url: "https://cdn.example.com/p.webp", anchor: "#0B0F19", dim: 40 });
  assert.ok(css.startsWith("linear-gradient(#0b0f1966,#0b0f1966),"), "40% scrim tints toward the anchor");
  assert.ok(css.includes('url("https://cdn.example.com/p.webp") center/cover no-repeat'), "photo covers");
  assert.ok(css.endsWith(",#0b0f19"), "anchor backs the stack");

  // Defaults + clamps.
  assert.ok(
    bgCss({ kind: "image", url: "https://x.example/p.jpg", anchor: "#0b0f19" }).startsWith("linear-gradient(#0b0f1959"),
    "default dim 35%",
  );

  // anchorOf: the image's anchor IS the solid stand-in (rings, ink).
  assert.equal(anchorOf({ kind: "image", url: "https://x.example/p.jpg", anchor: "#F8FAFC" }), "#f8fafc");
  // Light anchor → dark page ink, same math as every other background.
  const ink = pageInkOn("#f8fafc");
  assert.ok(ink.text.startsWith("#0") || ink.text.startsWith("#1"), "light anchor gets dark ink");
});
