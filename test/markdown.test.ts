/**
 * Markdown surface — the LLM-readable profile, held to the honesty
 * rules: direct URLs, no icon-token leaks, hostile text neutralized,
 * every sibling surface cross-linked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SCHEMA_VERSION, type IdentityManifest } from "../src/lib/identity";
import { getRenderer } from "../src/lib/registry";
import "../src/lib/blocks/builtin";
import { mdEscape, renderProfileMarkdown } from "../src/lib/renderers/markdown";

const CTX = { origin: "https://links.example.com" };

function fixture(overrides: Partial<IdentityManifest> = {}): IdentityManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    identityId: "idn_mdtest1234567890abcd",
    identityType: "business",
    owner: "admin",
    handle: "marisayvettehair",
    displayName: "Marisa Yvette",
    bio: "Book your next appointment.\nWalk-ins welcome, too.",
    avatar: "https://i.ibb.co/example/logo.webp",
    theme: "signal",
    blocks: [
      { id: "b1", type: "link", order: 0, data: { label: "Book an appointment", url: "https://book.example.com", icon: "soc:instagram" } },
      { id: "b2", type: "header", order: 1, data: { text: "Hours" } },
      { id: "b3", type: "text", order: 2, data: { text: "Tue–Sat, 9–6" } },
      { id: "b4", type: "link", order: 3, data: { label: "Unfilled", url: "https://", icon: "" } },
      { id: "b5", type: "social", order: 4, data: { links: [{ network: "Instagram", url: "https://instagram.com/marisa" }] } },
      { id: "b6", type: "surfaces", order: 5, data: { vcard: true } },
      { id: "b7", type: "embed", order: 6, data: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Salon tour" } },
    ],
    capabilities: [],
    renderers: [],
    status: "published",
    publishedAt: "2026-07-05T12:00:00.000Z",
    createdAt: "2026-07-05T11:00:00.000Z",
    updatedAt: "2026-07-05T12:34:56.789Z",
    ...overrides,
  };
}

test("markdown: front matter, reading order, and the formats grammar", () => {
  const md = renderProfileMarkdown(fixture(), CTX);

  // Front matter opens the document — five fields a machine wants first.
  assert.ok(md.startsWith("---\n"), "opens with YAML front matter");
  assert.ok(md.includes('name: "Marisa Yvette"'));
  assert.ok(md.includes('handle: "marisayvettehair"'));
  assert.ok(md.includes('type: "business"'));
  assert.ok(md.includes('url: "https://links.example.com/marisayvettehair"'));
  assert.ok(md.includes('avatar: "https://i.ibb.co/example/logo.webp"'));
  assert.ok(md.includes('updated: "2026-07-05T12:34:56.789Z"'));

  // Body in reading order: title, multi-line bio as blockquote, socials.
  assert.ok(md.includes("# Marisa Yvette (@marisayvettehair)"));
  assert.ok(md.includes("> Book your next appointment."));
  assert.ok(md.includes("> Walk-ins welcome, too."));
  assert.ok(md.includes("## Social\n- [Instagram](https://instagram.com/marisa)"));

  // Blocks: DIRECT urls (never /go/ redirects), headers become ##.
  assert.ok(md.includes("- [Book an appointment](https://book.example.com)"));
  assert.equal(md.includes("/go/"), false, "machine surface tells the truth — no tracking redirects");
  assert.ok(md.includes("## Hours"));
  assert.ok(md.includes("Tue–Sat, 9–6"));
  assert.ok(md.includes("- [Salon tour](https://youtu.be/dQw4w9WgXcQ)"));

  // Honesty rules: unfilled links and icon tokens never appear.
  assert.equal(md.includes("Unfilled"), false, "placeholder links don't exist here either");
  assert.equal(md.includes("soc:"), false, "icon tokens are visual chrome — never leaked");

  // The formats section teaches the whole URL grammar in one fetch.
  assert.ok(md.includes("## This profile in other formats"));
  for (const f of ["?format=vcard", "?format=qr", "?format=card", "?format=json"]) {
    assert.ok(md.includes(`https://links.example.com/marisayvettehair${f}`), `links ${f}`);
  }
  assert.ok(md.includes("https://links.example.com/marisayvettehair.md"), "links its own .md shape");
  assert.ok(md.includes("Published with NEDB Links"), "brand in the footer");
});

test("markdown: hostile text is neutralized, not rendered", () => {
  const md = renderProfileMarkdown(
    fixture({
      displayName: "Evil [x](https://evil.example) <script>",
      bio: "`inject` *bold* _sneak_",
      blocks: [
        { id: "b1", type: "link", order: 0, data: { label: "a](https://evil.example) b", url: "https://ok.example/path(1)", icon: "" } },
        { id: "b2", type: "header", order: 1, data: { text: "[h]" } },
      ],
    }),
    CTX,
  );
  // Front matter carries the name as quoted YAML DATA (consumers parse
  // YAML there, not markdown) — the escaping contract applies to the BODY.
  const body = md.slice(md.indexOf("---", 4) + 4);
  assert.equal(body.includes("[x](https://evil.example)"), false, "label bracket injection escaped in the body");
  assert.ok(body.includes("\\[x\\]"), "brackets escaped in place");
  assert.ok(md.includes("&lt;script&gt;"), "raw HTML never passes through");
  assert.ok(md.includes("\\`inject\\`") && md.includes("\\*bold\\*") && md.includes("\\_sneak\\_"), "md formatting from users is literal");
  assert.ok(md.includes("(https://ok.example/path%281%29)"), "URL parens encoded — the link can't break out");
  // And a URL that fails the storable check (e.g. embedded spaces) simply
  // never renders — the skip rule is the same on every surface.
  assert.ok(md.includes("## \\[h\\]"), "headers escaped too");
  // Front matter stays a value even with quotes in the name.
  const q = renderProfileMarkdown(fixture({ displayName: 'A "quoted" name' }), CTX);
  assert.ok(q.includes('name: "A \\"quoted\\" name"'));
});

test("markdown: registered as the sixth surface", () => {
  const r = getRenderer("md");
  assert.ok(r, "md renderer registered");
  const out = r.render(fixture(), CTX) as { contentType: string; body: string };
  assert.equal(out.contentType, "text/markdown; charset=utf-8");
  assert.ok(String(out.body).includes("# Marisa Yvette"));
});
