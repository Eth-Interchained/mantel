/**
 * The font vault — 3 free, the rest premium, every entry sane. The
 * enum IS the input: labels, CSS stacks, and Google params come from
 * this map only, so its integrity is a security property.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FONTS, FONT_IDS, FREE_FONT_IDS, isPremiumFont } from "../src/lib/identity";

test("the vault: hella fonts, exactly three free", () => {
  assert.ok(FONT_IDS.length >= 35, `comprehensive list (got ${FONT_IDS.length})`);
  assert.deepEqual(FREE_FONT_IDS.sort(), ["inter", "poppins", "system"], "the free trio");
  assert.ok(isPremiumFont("orbitron"), "the brand font is a premium unlock");
  assert.equal(isPremiumFont("inter"), false);
  assert.equal(isPremiumFont("not-a-font"), false, "unknown ids are not premium — they're invalid upstream");
});

test("every entry is complete and its Google param is shaped right", () => {
  for (const id of FONT_IDS) {
    const f = FONTS[id];
    assert.ok(f.label.length > 2, `${id} labeled`);
    assert.ok(["free", "premium"].includes(f.tier), `${id} tiered`);
    assert.ok(f.css.length > 5, `${id} has a CSS stack`);
    if (f.google !== null) {
      // Google Fonts v2 axis grammar: family, optionally :wght@… and/or
      // :ital@… (Instrument Serif ships an italic axis, no weights).
      assert.match(
        f.google,
        /^[A-Za-z+]+(:(wght|ital)@[\d;]+)?$/,
        `${id} google param sane: ${f.google}`,
      );
      assert.equal(f.google.includes(" "), false, `${id} google param has no raw spaces`);
    }
  }
  // Legacy ids survive — existing manifests keep their fonts forever.
  for (const legacy of ["system", "inter", "space-grotesk", "poppins", "montserrat", "playfair", "lora", "dm-serif", "jetbrains-mono", "caveat"]) {
    assert.ok(FONT_IDS.includes(legacy as (typeof FONT_IDS)[number]), `legacy font kept: ${legacy}`);
  }
});
