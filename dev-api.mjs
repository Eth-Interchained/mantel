/**
 * Dev API wrapper — kills the port-skew trap.
 *
 * The trap (found live by Mark): Vite watches .env and restarts itself
 * with fresh values, but `tsx watch` only watches source files — so an
 * .env port change moved the proxy target while the API kept listening
 * on the OLD port. Every /api call: ECONNREFUSED, surfacing in the UI
 * as "Failed to fetch" at whatever the user touched first (his case:
 * the sign-in challenge).
 *
 * This wrapper spawns `tsx watch server.ts` (source hot-reload stays)
 * and additionally watches .env itself — on change it restarts the API
 * child, so BOTH sides of the proxy re-read the environment together.
 * Zero dependencies, dev-only, never used in production (`npm start`
 * runs tsx directly).
 */

import { spawn } from "node:child_process";
import { existsSync, watchFile, unwatchFile } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");

/**
 * Resolve tsx's JS entry and run it with THIS node binary. Spawning
 * "npx" breaks on Windows (npx is npx.cmd — spawn ENOENT without a
 * shell); an absolute node path + a .mjs file path works on every
 * platform with zero shell involvement.
 */
const require = createRequire(import.meta.url);
const tsxPkgPath = require.resolve("tsx/package.json");
const tsxPkg = require("tsx/package.json");
const tsxBinRel = typeof tsxPkg.bin === "string" ? tsxPkg.bin : tsxPkg.bin.tsx;
const TSX = resolve(dirname(tsxPkgPath), tsxBinRel);

let child = null;
let restarting = false;
let shuttingDown = false;

function start() {
  child = spawn(process.execPath, [TSX, "watch", "server.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  // spawn failures emit 'error', not 'exit' — without this handler the
  // wrapper itself dies with an unhandled 'error' event (seen live on
  // Windows as the npx ENOENT crash).
  child.on("error", (err) => {
    if (shuttingDown) return;
    console.error(`[api] failed to start (${err.message}) — retrying in 2s`);
    setTimeout(start, 2000);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (restarting) {
      restarting = false;
      start();
      return;
    }
    // Crashed on its own (bad .env, port in use, …): retry with backoff
    // so fixing .env self-heals without a manual restart.
    console.error(
      `[api] exited (${signal ?? code}) — retrying in 2s (fix .env / free the port and it heals itself)`,
    );
    setTimeout(start, 2000);
  });
}

function restart(reason) {
  console.log(`[api] ⟳ ${reason} — restarting so the API re-reads it`);
  restarting = true;
  if (child && !child.killed) child.kill("SIGTERM");
  else start();
}

if (existsSync(ENV_PATH)) {
  watchFile(ENV_PATH, { interval: 700 }, () => restart(".env changed"));
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    shuttingDown = true;
    unwatchFile(ENV_PATH);
    if (child && !child.killed) child.kill("SIGTERM");
    process.exit(0);
  });
}

start();
