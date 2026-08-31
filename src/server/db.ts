/**
 * The single NEDB touchpoint — EMBEDDED. mantel runs the engine in-process
 * via the `nedb-engine` napi addon (v2 DAG store): no daemon, no port, no
 * HTTP hop. The Db opens at boot from a local data dir; verify(), NQL and
 * TRACE are direct native calls inside the request handler.
 *
 * This module preserves the exact surface the rest of the server consumed
 * from nedb-engine-client (put/get/query/delete/verify/health/ping/
 * createDatabase/dropDatabase), so call sites are untouched. Methods stay
 * async for drop-in compatibility even though the native calls are sync.
 *
 * NEDB stores knowledge. Portal renders experiences. mantel shows what your
 * hearth can actually run.
 */

import { rmSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createRequire } from "node:module";
import { config } from "./config";

const require = createRequire(import.meta.url);

interface NedbCoreHandle {
  put(coll: string, id: string, docJson: string): string;
  get(coll: string, id: string): string | null;
  query(nql: string): string[];
  delete(coll: string, id: string): void;
  verify(): boolean;
  head(): string;
  seq(): bigint;
  flush(): void;
  tip(): string | null;
  tipCollection(coll: string): string | null;
}

// CJS native addon — createRequire keeps this ESM-friendly under tsx.
const { NedbCore } = require("nedb-engine") as {
  NedbCore: { open(path: string): NedbCoreHandle };
};

/** Mirrors nedb-engine-client's PutResult — the write receipt. The stored
 *  node is nested under `doc`; `seq`/`head` are the store's post-write state,
 *  which routes echo back to clients as the write's public receipt. */
export interface PutResult {
  ok: boolean;
  doc: Record<string, unknown>;
  seq: number;
  head: string;
}

/** Mirrors nedb-engine-client's VerifyResult. `tampered` is always empty on
 *  the embedded path when ok is true; the napi surface reports the boolean
 *  outcome rather than the offending object list, so objects_checked is
 *  reported as -1 (unknown) rather than a fabricated count. */
export interface VerifyResult {
  ok: boolean;
  seq: number;
  head: string;
  tamper_evident: boolean;
  objects_checked: number;
  tampered: string[];
}

export interface PutOptions {
  /** Hash chain: _hash values of this write's causal parents. */
  causedBy?: string[];
  /** Human-readable provenance note, stored on the document. */
  evidence?: string;
  /** Provenance confidence 0..1, stored on the document. */
  confidence?: number;
  validFrom?: string;
  validTo?: string;
  /** Idempotency key.
   *
   *  NOT HONORED on the embedded path: the v2 engine's napi surface accepts
   *  idem on put_ex and documents it as "API compat, v2 ignores these" — v2
   *  has no dedupe table. Kept in the type so call sites written for the
   *  daemon still compile and still state their intent, but callers must NOT
   *  rely on it for correctness. Where uniqueness actually matters (handle
   *  claims) the guard is the read-back-after-write, which is what tells a
   *  losing concurrent writer the truth. We log once per process so this is
   *  never a silent no-op. */
  idem?: string;
}

/**
 * Normalize a node returned by the native addon.
 *
 * ENGINE GAP (verified against nedb-engine 2.8.x, embedded napi path): the
 * addon's node serializer injects _id/_hash/_seq/_coll but NOT _caused_by —
 * unlike nedbd's HTTP surface, which returns it. The causal edge is really
 * created (TRACE walks it correctly); only the read projection omits it. The
 * addon also leaves the `caused_by` key sitting in user data, since it copies
 * the lane value out without removing the key.
 *
 * So we surface _caused_by from that residual key and keep the shape the rest
 * of the server was written against. When the engine starts emitting
 * _caused_by itself, the existing value wins and this becomes a no-op.
 *
 * Upstream fix filed against Eth-Interchained/nedb:
 * rust/crates/nedb-node/src/lib.rs → node_to_json_str should inject
 * _caused_by (and the valid_from/valid_to lanes) like the daemon does.
 */
function normalizeNode(node: Record<string, unknown>): Record<string, unknown> {
  if (node._caused_by === undefined && Array.isArray(node.caused_by)) {
    node._caused_by = node.caused_by;
  }
  return node;
}

let core: NedbCoreHandle | null = null;
let idemWarned = false;

/** Open-once accessor. Throws with the data dir named if open fails —
 *  never returns a half-open handle. */
function engine(): NedbCoreHandle {
  if (!core) core = NedbCore.open(config.nedbDataDir);
  return core;
}

function engineVersion(): string {
  try {
    return (require("nedb-engine/package.json") as { version: string }).version;
  } catch (err) {
    // Not fatal — the engine itself loaded, only its manifest didn't.
    console.warn(
      "[mantel] could not read nedb-engine/package.json for version reporting:",
      err instanceof Error ? err.message : err,
    );
    return "unknown";
  }
}

export const db = {
  /** Put a document. Provenance opts are lifted into the engine's
   *  caused_by / valid_from / valid_to lanes; evidence and confidence ride
   *  on the document itself. Returns the stored node (with _id/_hash/_seq). */
  async put(
    coll: string,
    id: string,
    doc: Record<string, unknown>,
    opts: PutOptions = {},
  ): Promise<PutResult> {
    const payload: Record<string, unknown> = { ...doc };
    if (opts.causedBy && opts.causedBy.length > 0) payload.caused_by = opts.causedBy;
    if (opts.evidence !== undefined) payload.evidence = opts.evidence;
    if (opts.confidence !== undefined) payload.confidence = opts.confidence;
    if (opts.validFrom !== undefined) payload.valid_from = opts.validFrom;
    if (opts.validTo !== undefined) payload.valid_to = opts.validTo;
    if (opts.idem !== undefined && !idemWarned) {
      idemWarned = true;
      console.warn(
        `[mantel] put() was given an idempotency key ("${opts.idem}") but the ` +
          `embedded v2 engine does not honor idem — it has no dedupe table. ` +
          `Uniqueness must be enforced by read-back-after-write at the call site. ` +
          `(Logged once per process.)`,
      );
    }
    const e = engine();
    const stored = normalizeNode(
      JSON.parse(e.put(coll, id, JSON.stringify(payload))) as Record<string, unknown>,
    );
    return { ok: true, doc: stored, seq: Number(e.seq()), head: e.head() };
  },

  async get(coll: string, id: string): Promise<Record<string, unknown> | null> {
    const raw = engine().get(coll, id);
    return raw ? normalizeNode(JSON.parse(raw) as Record<string, unknown>) : null;
  },

  async query(nql: string): Promise<unknown[]> {
    return engine()
      .query(nql)
      .map((r) => normalizeNode(JSON.parse(r) as Record<string, unknown>));
  },

  async delete(coll: string, id: string): Promise<boolean> {
    engine().delete(coll, id);
    return true;
  },

  /** Integrity report — matches nedb-engine-client's VerifyResult, so the
   *  verify beacon (raffles.ts) and the health route read the same fields. */
  async verify(): Promise<VerifyResult> {
    const e = engine();
    const ok = e.verify();
    return {
      ok,
      seq: Number(e.seq()),
      head: e.head(),
      tamper_evident: true,
      // The napi verify() returns a boolean, not the checked-object count.
      // -1 means "not reported by this transport" — never a made-up number.
      objects_checked: -1,
      tampered: [],
    };
  },

  async health(): Promise<{
    ok: boolean;
    version?: string;
    engine: string;
    seq: number;
    head: string;
  }> {
    const e = engine();
    return {
      ok: true,
      version: engineVersion(),
      engine: "embedded-v2-dag",
      seq: Number(e.seq()),
      head: e.head(),
    };
  },

  /** Embedded engines are in-process: reachable iff open() succeeded. */
  async ping(): Promise<boolean> {
    try {
      engine();
      return true;
    } catch (err) {
      console.error(
        `[mantel] embedded engine failed to open at ${config.nedbDataDir}: ` +
          `${err instanceof Error ? err.message : String(err)} — ` +
          `possible causes: unwritable path, a data dir written by an incompatible ` +
          `engine version, or a missing native addon for this platform.`,
      );
      return false;
    }
  },

  /** Embedded: open() creates the data dir. Kept so boot code and tests
   *  read identically to the client era. */
  async createDatabase(): Promise<boolean> {
    engine();
    return true;
  },

  /** Test-suite hygiene only. Refuses any data dir whose basename doesn't
   *  look like a scratch dir, so a mis-set env can never delete real data. */
  async dropDatabase(): Promise<boolean> {
    const dir = config.nedbDataDir;
    if (!/test/i.test(basename(dir))) {
      throw new Error(
        `[mantel] refusing to drop data dir "${dir}" — its basename does not ` +
          `look like a scratch/test dir. Remove it by hand if that's really the intent.`,
      );
    }
    try {
      engine().flush();
    } catch (err) {
      // Non-fatal: the dir is about to be removed. Say so rather than
      // swallowing it, so a flush bug can't hide behind cleanup.
      console.warn(
        "[mantel] flush before dropDatabase failed (continuing to remove):",
        err instanceof Error ? err.message : err,
      );
    }
    core = null;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return true;
  },

  /** Flush WAL + MANIFEST now. The addon also flushes on exit/SIGTERM. */
  async flush(): Promise<void> {
    engine().flush();
  },

  /** The most recent write overall, or in one collection — the cheap
   *  "latest" primitive the ingestion cursor uses. */
  async tip(coll?: string): Promise<Record<string, unknown> | null> {
    const e = engine();
    const raw = coll ? e.tipCollection(coll) : e.tip();
    return raw ? normalizeNode(JSON.parse(raw) as Record<string, unknown>) : null;
  },
};

/** Provenance helper: the _hash of a document's current version, so the
 *  next put can chain causedBy to it. Returns [] for new documents. */
export function causalParent(doc: Record<string, unknown> | null): string[] {
  const h = doc && typeof doc._hash === "string" ? (doc._hash as string) : null;
  return h ? [h] : [];
}
