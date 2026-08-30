/**
 * Upload path live suite — auth wall, magic-byte sniffing, size caps,
 * throttle, and the full endpoint round trip (LINKS_UPLOAD_TEST=1
 * stubs the image host; everything else is real).
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_uploads_${Date.now().toString(36)}`;
process.env.LINKS_UPLOAD_TEST = "1";
delete process.env.LINKS_ADMIN_TOKEN;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { sniffImage, throttleOk } = await import("../src/server/uploads");
const { deriveAccount, generatePhrase, signMessage } = await import("../src/lib/wallet");

let server: Server;
let base: string;
let session = "";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

async function walletLogin(): Promise<string> {
  const phrase = generatePhrase();
  const { address } = await deriveAccount(phrase);
  const chal = (await (
    await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
  ).json()) as { challengeId: string; message: string };
  const signature = await signMessage(phrase, chal.message);
  const r = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: chal.challengeId, address, signature }),
  });
  return ((await r.json()) as { token: string }).token;
}

function upload(body: Buffer, type = "image/png", token = session): Promise<Response> {
  return fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { "content-type": type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: new Uint8Array(body),
  });
}

before(async () => {
  assert.ok(await db.ping(), "nedbd is not reachable");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  session = await walletLogin();
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("sniffImage: magic bytes rule, headers are suggestions", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpeg");
  const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
  assert.equal(sniffImage(webp), "webp");
  assert.equal(sniffImage(Buffer.from("GIF89a000000", "latin1")), "gif");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)></svg>")), null, "svg/script never passes");
  assert.equal(sniffImage(Buffer.alloc(4)), null, "too short never passes");
});

test("throttleOk: twelve in the window, the thirteenth waits", () => {
  const who = "itc1qthrottle-test";
  const t0 = 1_000_000;
  for (let i = 0; i < 12; i++) {
    assert.equal(throttleOk(who, t0 + i), true, `upload ${i + 1} allowed`);
  }
  assert.equal(throttleOk(who, t0 + 100), false, "13th inside the window blocked");
  assert.equal(throttleOk(who, t0 + 11 * 60 * 1000), true, "window expiry frees it");
});

test("the endpoint: authed round trip returns a hosted URL", async () => {
  const anon = await upload(PNG, "image/png", "");
  assert.equal(anon.status, 401, "anonymous uploads bounce");

  const r = await upload(PNG);
  assert.equal(r.status, 200, "authed upload lands");
  const j = (await r.json()) as { url: string };
  assert.match(j.url, /^https:\/\//, "a hosted URL comes back");
});

test("the endpoint: junk bytes and oversized bodies are rejected", async () => {
  const junk = await upload(Buffer.from("#!/bin/sh\nrm -rf /\n"), "image/png");
  assert.equal(junk.status, 400, "shell scripts wearing image hats bounce");

  const huge = await upload(Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]), "image/png");
  assert.equal(huge.status, 413, "oversized bodies bounce at the cap");
});
