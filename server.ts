/**
 * NEDB Links — Express server bootstrap.
 *
 * NEDB stores knowledge. Portal renders experiences. Links publishes identity.
 *
 * App assembly lives in src/server/app.ts (createApp) so tests can boot
 * the real app against a real nedbd. This file only loads env, ensures
 * the database, and listens.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env loader (no dependency). Real env always wins. */
function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

// Imported AFTER loadEnv so config reads the resolved environment.
const { config, validateConfig } = await import("./src/server/config");

{
  const problems = validateConfig(config);
  if (problems.length > 0) {
    console.error("\x1b[31m[links] configuration is incomplete:\x1b[0m");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}
const { createApp, ensureDatabase } = await import("./src/server/app");
const { warnIfOpen } = await import("./src/server/auth");

// Ensure the database exists BEFORE the first write. Idempotent.
// Works around a nedbd 2.6.1 interop bug found in Links' first smoke test:
// on an unknown-db 404 the daemon responds without draining the request
// body, so the client's auto-create retry on the same keep-alive socket
// gets misparsed ("Bad request syntax"). Creating the db up front keeps
// every write on the happy path. Proper fix lands engine-side.
await ensureDatabase();

const server = createApp().listen(config.port, () => {
  console.log(`\x1b[36m⬡ NEDB Links\x1b[0m listening on :${config.port}`);
  console.log(`  nedbd → ${config.nedbUrl} (db: ${config.nedbDb})`);
  warnIfOpen();
});

// The #1 boot killer is a port collision (PORT is read by many tools —
// vite included). Die LOUD and actionable, never with a bare stack.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\x1b[31m[links] port ${config.port} is already in use.\x1b[0m\n` +
        `  Another process (the Vite dev client? a second links instance?) holds it.\n` +
        `  Fix: set LINKS_API_PORT to a free port in .env — the dev proxy follows\n` +
        `  the same variable automatically. (Generic PORT also works but is read\n` +
        `  by other tools; LINKS_API_PORT is unambiguous.)`,
    );
  } else {
    console.error(`[links] server error: ${err.message}`);
  }
  process.exit(1);
});
