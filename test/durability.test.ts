/**
 * Hard-stop durability — the reboot lesson, pinned.
 *
 * Production event (2026-08-30): a VPS reboot emptied the catalog. Root
 * cause candidates were an unflushed WAL (exit hook never ran under the
 * npx->tsx->node chain) or a cwd-relative data dir. The fix is explicit
 * flush-after-batch in the ingest and review routes, so durability never
 * depends on a graceful exit.
 *
 * This test proves it the only honest way: write through the real ingest
 * route in a CHILD PROCESS, SIGKILL it (no exit hook possible), then reopen
 * the same data dir in THIS process and demand the rows are there.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(`./.tmp/mantel_durability_${Date.now().toString(36)}_test`);

test("ingested rows survive SIGKILL — no exit hook, no mercy", async () => {
  mkdirSync("./.tmp", { recursive: true });

  // Child: boot the real app on an ephemeral port, print the port, serve.
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "test/helpers/durability-child.mts"],
    {
      env: {
        ...process.env,
        NEDB_DATA_DIR: DIR,
        MANTEL_OPERATOR_TOKEN: "dur-token",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  const port: number = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`child never reported a port; output so far: ${buf}`)), 30000);
    child.stdout.on("data", (d) => {
      buf += String(d);
      const m = buf.match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolvePort(Number(m[1]));
      }
    });
    child.on("exit", (code) => reject(new Error(`child exited early (${code}); output: ${buf}`)));
  });

  const r = await fetch(`http://127.0.0.1:${port}/api/ingest/model`, {
    method: "POST",
    headers: { authorization: "Bearer dur-token", "content-type": "application/json" },
    body: JSON.stringify({
      id: "survivor:1b",
      name: "Survivor",
      quants: [{ name: "Q4_K_M", fileGib: 1.0, minVramGib: null }],
    }),
  });
  assert.equal(r.status, 201, "the write must be confirmed before the kill");

  // SIGKILL: the exit-flush hook CANNOT run. This models the reboot.
  child.kill("SIGKILL");
  await new Promise((res) => child.on("exit", res));

  // Reopen the same dir in this process — the row must be on disk.
  process.env.NEDB_DATA_DIR = DIR;
  const { db } = await import("../src/server/db");
  const doc = await db.get("models", "survivor:1b");
  assert.ok(doc, "the ingested model survived SIGKILL — flush-after-batch held");
  assert.equal((doc as { name: string }).name, "Survivor");
  await db.dropDatabase();
});
