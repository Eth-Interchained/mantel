/**
 * Discover directory — consent, projection safety, filtering, and the
 * rendered page. The invariant that matters most: NOTHING an owner
 * didn't opt into ever appears, and nothing private ever leaves.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterEntries,
  isDiscoverable,
  renderDirectoryHtml,
  toDirectoryEntry,
  type DirectoryEntry,
} from "../src/lib/directory";
import { RESERVED_HANDLES, SCHEMA_VERSION, type IdentityManifest } from "../src/lib/identity";

function m(over: Partial<IdentityManifest> = {}): IdentityManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    identityId: "idn_dir1",
    identityType: "business",
    owner: "eml_secret_principal",
    handle: "marisa",
    displayName: "Marisa Yvette",
    bio: "Hair, color, and confidence.",
    avatar: "https://i.ibb.co/x/logo.webp",
    blocks: [],
    capabilities: [],
    renderers: [],
    status: "published",
    publishedAt: "2026-07-06T12:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-06T12:00:00.000Z",
    ...over,
  };
}

test("discoverable = published AND explicit consent, nothing implied", () => {
  assert.equal(isDiscoverable(m({ discoverable: true })), true);
  assert.equal(isDiscoverable(m()), false, "publishing alone NEVER lists you");
  assert.equal(isDiscoverable(m({ discoverable: false })), false);
  assert.equal(isDiscoverable(m({ discoverable: true, status: "draft" })), false, "drafts never list");
});

test("the projection is the SAFE surface — owner/principal never leave", () => {
  const e = toDirectoryEntry(m({ owner: "eml_deadbeef", discoverable: true }));
  assert.deepEqual(Object.keys(e).sort(), ["avatar", "bio", "displayName", "handle", "identityType", "publishedAt"]);
  assert.equal(JSON.stringify(e).includes("eml_"), false, "no principal-shaped anything");
});

test("filterEntries: search, type, newest-first", () => {
  const entries: DirectoryEntry[] = [
    toDirectoryEntry(m({ handle: "alpha", displayName: "Alpha Co", identityType: "business", publishedAt: "2026-07-01T00:00:00Z" })),
    toDirectoryEntry(m({ handle: "beta", displayName: "Beta Person", bio: "I paint murals", identityType: "personal", publishedAt: "2026-07-03T00:00:00Z" })),
    toDirectoryEntry(m({ handle: "gamma", displayName: "Gamma Events", identityType: "event", publishedAt: "2026-07-02T00:00:00Z" })),
  ];
  assert.deepEqual(filterEntries(entries).map((e) => e.handle), ["beta", "gamma", "alpha"], "newest first");
  assert.deepEqual(filterEntries(entries, "murals").map((e) => e.handle), ["beta"], "bio substring matches");
  assert.deepEqual(filterEntries(entries, "GAMMA").map((e) => e.handle), ["gamma"], "case-insensitive");
  assert.deepEqual(filterEntries(entries, undefined, "business").map((e) => e.handle), ["alpha"], "type filter");
  assert.deepEqual(filterEntries(entries, "alpha", "event"), [], "q and type compose");
});

test("directory page: escaped, src-tagged, honest when empty", () => {
  const hostile = toDirectoryEntry(
    m({ displayName: '<script>alert(1)</script>', bio: 'a"b<c>', discoverable: true }),
  );
  const html = renderDirectoryHtml([hostile], { origin: "https://links.example.com", brand: "OurLynx" });
  assert.equal(html.includes("<script>alert"), false, "names are data, never markup");
  assert.ok(html.includes("&lt;script&gt;"), "escaped in place");
  assert.ok(html.includes('href="https://links.example.com/marisa?src=discover"'), "cards feed the existing source analytics");
  assert.ok(html.includes("OurLynx"), "deployment-branded");

  const empty = renderDirectoryHtml([], { origin: "https://x.example" });
  assert.ok(empty.includes("Nobody's listed yet"), "empty state invites, not apologizes");
  const searched = renderDirectoryHtml([], { origin: "https://x.example", q: "zzz" });
  assert.ok(searched.includes("No profiles match"), "empty search says so");
});

test("the discover handle can never be claimed", () => {
  assert.ok(RESERVED_HANDLES.has("discover"));
  assert.ok(RESERVED_HANDLES.has("discovery"));
});
