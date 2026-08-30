/**
 * App theme machinery — the pure parts.
 *
 * getTheme/applyTheme touch localStorage and the DOM (browser-only);
 * the cycle and the validator are pure and tested here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isThemeName, nextTheme, THEME_LABELS, THEME_ORDER } from "../src/lib/theme";

test("theme cycle visits all five registers and wraps", () => {
  assert.deepEqual(THEME_ORDER, ["pro", "native", "v3", "mach", "kundli"]);
  assert.equal(nextTheme("pro"), "native");
  assert.equal(nextTheme("native"), "v3");
  assert.equal(nextTheme("v3"), "mach");
  assert.equal(nextTheme("mach"), "kundli");
  assert.equal(nextTheme("kundli"), "pro", "cycle wraps back to pro");

  // Every theme has a switcher label.
  for (const t of THEME_ORDER) {
    assert.ok(THEME_LABELS[t].length > 0, `label for ${t}`);
  }
});

test("isThemeName gates persisted values (old storage stays valid, junk falls back)", () => {
  assert.equal(isThemeName("pro"), true);
  assert.equal(isThemeName("native"), true);
  assert.equal(isThemeName("v3"), true);
  assert.equal(isThemeName("mach"), true);
  assert.equal(isThemeName("midnight"), false, "renderer palettes are not app themes");
  assert.equal(isThemeName(""), false);
  assert.equal(isThemeName(null), false);
  assert.equal(isThemeName("V3"), false, "case-sensitive — attribute selectors are");
});

test("the pre-paint allowlist in index.html tracks THEME_ORDER", async () => {
  // index.html restores the theme BEFORE any module loads, so it carries
  // a hand-written duplicate of the theme list. A theme missing there
  // silently falls back to pro — caught live when kundli did exactly
  // that. This test makes the duplicate honest.
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("index.html", "utf8");
  const m = /var ok = \{([^}]*)\}/.exec(html);
  assert.ok(m, "the allowlist is still shaped as expected");
  const listed = m[1]
    .split(",")
    .map((p) => p.split(":")[0].trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(listed, [...THEME_ORDER].sort(), "every theme is restorable pre-paint");
});
