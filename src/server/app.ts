/**
 * App assembly — everything except env loading and listening.
 *
 * Exists as a factory so tests can boot the REAL app against a REAL
 * nedbd on an ephemeral port. NEDB Links does not test against mocks;
 * the engine is the system under test as much as the app is.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { accounts } from "./accounts";
import { admin } from "./admin";
import { accountsEmail } from "./accounts-email";
import { analytics, analyticsSummary } from "./analytics";
import { billing, mountWebhook } from "./billing";
import { mountCashfreeWebhook } from "./cashfree";
import { config } from "./config";
import { db } from "./db";
import { grants } from "./grants";
import { handles, identities } from "./identities";
import { payments } from "./payments";
import { preview } from "./preview";
import { purchases, purchasesApi } from "./purchases";
import { demo } from "./demo";
import { discover } from "./discover";
import { qrFlyer, qrStudio } from "./qrstudio";
import { raffles } from "./raffles";
import { render } from "./render";
import { uploads } from "./uploads";
import { upiQr } from "./upiqr";

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
  // Stripe webhook needs the raw body for signature verification —
  // mounted before the JSON parser touches anything.
  mountWebhook(app);
  // Same reason as Stripe's: HMAC is over exact bytes, so this must see
  // the raw body before any parser rewrites it.
  mountCashfreeWebhook(app);
  app.use(express.json({ limit: "8mb" }));
  // Zero-JS pages (/r/:id giveaway entry, confirm) submit real HTML
  // <form method="post"> — the browser sends application/x-www-form-
  // urlencoded, which express.json() silently ignores (req.body stays
  // {}). Without this, EVERY field looks "missing" to the server no
  // matter what the visitor typed — found live, the entry form was
  // unusable end-to-end.
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // ── Health — reports every dependency ────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    let nedb: { ok: boolean; version?: string; error?: string } = { ok: false };
    try {
      const h = await db.health();
      nedb = { ok: h.ok, version: h.version };
    } catch (err) {
      nedb = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    res.json({
      links: "ok",
      nedb,
      nedbUrl: config.nedbUrl,
      db: config.nedbDb,
      authConfigured: Boolean(config.adminToken),
      aiassist: { configured: Boolean(config.aiassistApiKey) },
    });
  });

  // ── Public deployment config — the client's mode switch ──────────────────
  app.get("/api/config", (_req, res) => {
    res.json({
      authMode: config.authMode,
      brandName: config.brandName,
      brandKey: config.brandKey,
      currency: config.currency,
      brandLogoUrl: config.brandLogoUrl || undefined,
      defaultTheme: config.defaultTheme,
      fiatDoor: Boolean(config.stripeSecretKey),
      limitEnabled: config.limitEnabled,
      uploads: Boolean(config.imgbbKey) || process.env.LINKS_UPLOAD_TEST === "1",
      // Public policy numbers — the homepage ledger states the deal
      // with the same figures the gates enforce.
      freeProfileLimit: config.freeProfileLimit,
      freeBlockLimit: config.freeBlockLimit,
      premiumProfileLimit: config.premiumProfileLimit,
    });
  });

  // ── API ───────────────────────────────────────────────────────────────────
  // ONE account system per deployment. The other product's endpoints
  // don't exist here — wallet routes 404 on ne-db.com and vice versa.
  app.use("/api/admin", admin);
  app.use("/api/auth", config.authMode === "email" ? accountsEmail : accounts);
  app.use("/api/analytics", analyticsSummary);
  app.use("/api/billing", billing);
  app.use("/api/handles", handles);
  app.use("/api/identities/:id/analytics", analytics);
  app.use("/api/identities/:id/grants", grants);
  app.use("/api/identities/:id/payments", payments);
  app.use("/api/identities/:id/purchases", purchasesApi);
  app.use("/api/identities/:id/qr", qrStudio);
  app.use("/api/identities", identities);
  app.use("/api/preview", preview);
  app.use("/api/upload", uploads);

  // ── Deployment brand files (/brand) ───────────────────────────────────────
  // Static files for the storefront: logo, favicon, og images.
  // LINKS_ASSETS_DIR (default ./public), served at /brand/<name>.
  // NOT /assets — Vite owns /assets for the SPA bundles (dist/assets/);
  // squatting there blackholed index-*.js and white-screened the app.
  // "brand" is a reserved handle; this mount sits before /:handle.
  const brandDir = resolve(process.cwd(), process.env.LINKS_ASSETS_DIR || "public");
  app.use("/brand", express.static(brandDir, { index: false, maxAge: "1h" }));
  // Terminal: a missing brand file is a 404, never the SPA shell.
  app.use("/brand", (_req: Request, res: Response) => {
    res.status(404).send("not found");
  });

  // ── Editor SPA (production build) ─────────────────────────────────────────
  const dist = resolve(process.cwd(), "dist");
  const hasDist = existsSync(join(dist, "index.html"));
  // Runtime brand injection: ONE build serves every deployment, so the
  // shell learns its identity when served, not when built. The injected
  // blob feeds the pre-paint theme script; branded deployments also get
  // their own <title> and meta description — crawlers and link previews
  // read the shell long before any client JS runs.
  const branded = config.brandName && config.brandName !== "NEDB Links";
  const shellHtml = hasDist
    ? readFileSync(join(dist, "index.html"), "utf8")
        .replace(
          "<head>",
          `<head><script>window.__LINKS_CONFIG__=${JSON.stringify({
            brandName: config.brandName,
            brandLogoUrl: config.brandLogoUrl || undefined,
            defaultTheme: config.defaultTheme,
            authMode: config.authMode,
          })}</script>${
            config.faviconUrl
              ? `<link rel="icon" href="${config.faviconUrl}" /><link rel="apple-touch-icon" href="${config.faviconUrl}" />`
              : ""
          }`,
        )
        .replace(
          /<title>[^<]*<\/title>/,
          branded
            ? `<title>${config.brandName} — one link that holds all your links</title>`
            : "$&",
        )
        .replace(
          /<meta\s+name="description"[^>]*>/s,
          branded
            ? `<meta name="description" content="Claim your handle on ${config.brandName}: one page for every link, a print-grade QR, save-my-contact, giveaways and live stats. Free forever — premium once, never monthly." />`
            : "$&",
        )
    : null;
  const sendShell = (res: Response): void => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(shellHtml);
  };
  if (hasDist) {
    app.get(["/", "/index.html"], (_req, res) => sendShell(res));
    app.use(express.static(dist, { index: false }));
  }

  // ── Public identity surfaces (/:handle, /go/*) ────────────────────────────
  // Discover mounts BEFORE /:handle so the directory wins the route.
  app.use(discover);
  app.use(raffles); // /r/:id pages + /api/raffles — before /:handle
  app.use(upiQr); // /upi/:identityId/:blockId.svg — before /:handle
  app.use(purchases); // /buy/:identityId/:blockId — before /:handle
  app.use(demo); // /demo — the homepage's live "what done looks like"
  app.use(qrFlyer); // /qr/flyer/:id — print sheet, before /:handle
  app.use(render);

  // ── SPA fallback ──────────────────────────────────────────────────────────
  app.get("*", (req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (hasDist) {
      sendShell(res);
      return;
    }
    res
      .status(503)
      .send("NEDB Links: no production build found. Run `npm run build`, or use `npm run dev`.");
  });

  return app;
}

/** Idempotent database bootstrap — see server.ts for the interop story. */
export async function ensureDatabase(): Promise<void> {
  try {
    await db.createDatabase();
    console.log(`\x1b[36m⬡\x1b[0m database ready: ${config.nedbDb}`);
  } catch (err) {
    console.warn(
      `\x1b[33m[links] could not ensure database (${err instanceof Error ? err.message : err}) — is nedbd running at ${config.nedbUrl}?\x1b[0m`,
    );
  }
}
