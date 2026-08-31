/**
 * App assembly — everything except env loading and listening.
 *
 * Exists as a factory so tests can boot the REAL app against the REAL
 * embedded engine on an ephemeral port. mantel does not test against mocks;
 * the engine is the system under test as much as the app is.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { config } from "./config";
import { db } from "./db";
import { fitAcrossProfiles, customProfile, fitModel, profileById, PROFILES } from "./fit";
import { ingest } from "./ingest";
import { getModel, models, signalsWire } from "./models";
import { feeds } from "./feeds";
import { reviews } from "./reviews";

export function createApp(): Express {
  const app = express();

  // ── Request logger ────────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    // req.originalUrl captured now — Express mutates req.url through routers.
    const originalUrl = req.originalUrl || req.url;
    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const color =
        status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";
      console.log(`${color}${status}\x1b[0m ${req.method} ${originalUrl} — ${ms}ms`);
    });
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // ── Health — the engine reports on itself, including integrity ────────────
  app.get("/api/health", async (_req, res) => {
    let nedb: {
      ok: boolean;
      version?: string;
      engine?: string;
      seq?: number;
      head?: string;
      verified?: boolean;
      error?: string;
    } = { ok: false };
    try {
      const h = await db.health();
      nedb = {
        ok: h.ok,
        version: h.version,
        engine: h.engine,
        seq: h.seq,
        head: h.head,
        verified: (await db.verify()).ok,
      };
    } catch (err) {
      nedb = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    res.json({
      mantel: "ok",
      nedb,
      dataDir: config.nedbDataDir,
      ingestConfigured: Boolean(config.operatorToken),
      aiassist: { configured: Boolean(config.aiassistApiKey), model: config.aiassistModel },
    });
  });

  // ── Public deployment config ──────────────────────────────────────────────
  app.get("/api/config", (_req, res) => {
    res.json({ brandName: config.brandName, profiles: PROFILES });
  });

  // ── Domain ────────────────────────────────────────────────────────────────
  app.use("/api/models", models);
  app.use("/api/signals", signalsWire);
  app.use("/api/ingest", ingest);
  app.use("/api/reviews", reviews);
  app.use("/api/feeds", feeds);

  // ── Fit: "will it run on my box?" ─────────────────────────────────────────
  app.get("/api/fit/:id", async (req: Request, res: Response) => {
    const model = await getModel(req.params.id);
    if (!model) {
      res.status(404).json({ error: "unknown model", id: req.params.id });
      return;
    }
    res.json({ id: req.params.id, fits: fitAcrossProfiles(readQuants(model)) });
  });

  // One model against one profile — a known id, or a raw VRAM figure in GiB.
  app.get("/api/fit/:id/:profile", async (req: Request, res: Response) => {
    const model = await getModel(req.params.id);
    if (!model) {
      res.status(404).json({ error: "unknown model", id: req.params.id });
      return;
    }
    const raw = req.params.profile;
    const profile = profileById(raw) ?? customProfile(Number(raw));
    if (!profile) {
      res.status(400).json({
        error: "unknown profile",
        profile: raw,
        hint: "pass a profile id from /api/config, or a VRAM figure in GiB (e.g. 20)",
        known: PROFILES.map((p) => p.id),
      });
      return;
    }
    res.json({ id: req.params.id, fit: fitModel(readQuants(model), profile) });
  });

  // ── SPA (production build) ────────────────────────────────────────────────
  const dist = resolve(process.cwd(), "dist");
  const hasDist = existsSync(join(dist, "index.html"));
  const shellHtml = hasDist
    ? readFileSync(join(dist, "index.html"), "utf8").replace(
        "<head>",
        `<head><script>window.__MANTEL_CONFIG__=${JSON.stringify({
          brandName: config.brandName,
        })}</script>`,
      )
    : "";

  if (hasDist) app.use(express.static(dist, { index: false, maxAge: "1h" }));

  app.get("*", (req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "unknown endpoint", path: req.path });
      return;
    }
    if (hasDist) {
      res.type("html").send(shellHtml);
      return;
    }
    res
      .status(503)
      .send("mantel: no production build found. Run `npm run build`, or use `npm run dev`.");
  });

  return app;
}

/**
 * Read a model's quant list defensively.
 *
 * Catalog rows come from the engine, and a hand-seeded or partially-migrated
 * row may carry a malformed quants array. A bad entry is SKIPPED WITH A LOG
 * naming what was wrong — never coerced, because coercing would mean inventing
 * a fileGib or a minVramGib, the one thing fit.ts exists to never do.
 */
function readQuants(
  model: Record<string, unknown>,
): { name: string; fileGib: number; minVramGib: number | null }[] {
  const raw = model.quants;
  if (!Array.isArray(raw)) {
    if (raw !== undefined) {
      console.warn(
        `[mantel] model ${String(model._id)} has a non-array "quants" field ` +
          `(${typeof raw}) — treating as no quant data`,
      );
    }
    return [];
  }
  const out: { name: string; fileGib: number; minVramGib: number | null }[] = [];
  for (const q of raw) {
    if (typeof q !== "object" || q === null) {
      console.warn(`[mantel] model ${String(model._id)}: skipping a non-object quant entry`);
      continue;
    }
    const e = q as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.fileGib !== "number") {
      console.warn(
        `[mantel] model ${String(model._id)}: skipping quant with missing name/fileGib ` +
          `(keys: ${Object.keys(e).join(", ")})`,
      );
      continue;
    }
    out.push({
      name: e.name,
      fileGib: e.fileGib,
      // Anything that is not a real number becomes null = "unmeasured".
      // Never a fallback to fileGib; see the comment in fit.ts.
      minVramGib: typeof e.minVramGib === "number" ? e.minVramGib : null,
    });
  }
  return out;
}

/** Open the embedded engine before the first request. Idempotent.
 *
 *  FATAL on failure, unlike the daemon era where a warning made sense
 *  (nedbd could come up late and the next request would succeed). Embedded
 *  there is no second chance: if the engine cannot open, every route 500s on
 *  its first query and the real cause gets buried request-side. Die loud, name
 *  the dir, list what could actually be wrong. */
export async function ensureDatabase(): Promise<void> {
  try {
    await db.createDatabase();
    const h = await db.health();
    console.log(
      `\x1b[36m⬡\x1b[0m embedded engine ready: ${config.nedbDataDir} ` +
        `(nedb-engine ${h.version}, ${h.engine}, seq ${h.seq})`,
    );
  } catch (err) {
    throw new Error(
      `[mantel] embedded NEDB engine failed to open at "${config.nedbDataDir}": ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        `  Possible causes: the path is not writable; the data dir was written by an ` +
        `incompatible engine version; or the nedb-engine native addon has no build ` +
        `for this platform (check \`npm ls nedb-engine\`).`,
    );
  }
}
