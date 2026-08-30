/** Server configuration — real env always wins over .env (loaded in server.ts). */

/**
 * mantel has no account system to choose between. Identity is derived
 * client-side from nickname + salt (BLAKE2b) and travels with each post as a
 * hash; the server stores the hash and nothing else. No password, no email, no
 * session — so there is no auth mode, no SMTP, and no wallet here.
 */
export interface MantelConfig {
  /** Express port. */
  port: number;
  /** Deployment wordmark — nav, page title, public footers. */
  brandName: string;
  /** Public origin for canonical URLs, share links and JSON-LD. */
  publicOrigin?: string;

  /** Data directory for the EMBEDDED NEDB engine (v2 DAG store). mantel runs
   *  the engine in-process — no nedbd, no URL, no token. One process per
   *  directory: the engine takes an exclusive lock and refuses split-brain
   *  opens, so this is a deploy constraint, not a preference. */
  nedbDataDir: string;

  /** Operator token gating non-public write routes — the ingestion endpoint
   *  above all. Absent = those routes refuse every request rather than
   *  running open. */
  operatorToken?: string;

  /** AiAS gateway — all inference (signal extraction, summaries) routes
   *  through it to PIN/muse. Absent = inference-backed features are disabled
   *  and say so, rather than silently returning empty results. */
  aiassistBaseUrl: string;
  aiassistApiKey?: string;
  /** Model id for extraction work. The -extract tunings pull structure out of
   *  supplied text without inventing content — the right tool for turning a
   *  forum post into a typed signal. */
  aiassistModel: string;
}

export function loadConfig(): MantelConfig {
  return {
    // MANTEL_API_PORT is canonical — the generic PORT is read by many tools
    // (vite, PaaS runtimes) and port collisions/skew follow.
    port: Number(process.env.MANTEL_API_PORT || process.env.PORT || 3001),
    brandName: (process.env.MANTEL_BRAND_NAME || "mantel").slice(0, 40),
    publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    nedbDataDir: process.env.NEDB_DATA_DIR || "./mantel-data",
    operatorToken: process.env.MANTEL_OPERATOR_TOKEN || undefined,
    aiassistBaseUrl: process.env.AIASSIST_BASE_URL || "https://api.aiassist.net",
    aiassistApiKey: process.env.AIASSIST_API_KEY || undefined,
    aiassistModel: process.env.AIASSIST_MODEL || "muse-extract:latest",
  };
}

export const config = loadConfig();

/**
 * Boot-time configuration problems worth dying over.
 *
 * mantel is deliberately runnable with almost nothing configured — clone,
 * `npm start`, browse. So this list is short by design and only catches
 * settings that are actively wrong, never merely absent.
 */
export function validateConfig(c: MantelConfig): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(c.port) || c.port <= 0 || c.port > 65535) {
    problems.push(`MANTEL_API_PORT must be a valid port number (got "${c.port}")`);
  }
  if (!c.nedbDataDir.trim()) {
    problems.push("NEDB_DATA_DIR must not be empty");
  }
  if (c.publicOrigin && !/^https?:\/\//.test(c.publicOrigin)) {
    problems.push(
      `PUBLIC_ORIGIN must include a scheme (got "${c.publicOrigin}") — ` +
        `canonical URLs and JSON-LD are built from it`,
    );
  }
  return problems;
}
