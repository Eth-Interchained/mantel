/**
 * The verify footer — the trust mark on every page, fed by real engine state.
 *
 * "tamper-evident · seq N · head abc123…" is not decoration: it is the
 * engine's live Merkle head and a real verify() verdict, the same numbers an
 * auditor would check. A failed stats fetch renders the static line only —
 * never a fake head.
 */

import React, { useEffect, useState } from "react";

import { getStats, type SiteStats } from "./api";

export function VerifyFooter(): React.ReactElement {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let alive = true;
    getStats()
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((err: unknown) => {
        console.warn(
          `[mantel] stats fetch failed (${err instanceof Error ? err.message : String(err)}) — footer stays static.`,
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  const live = stats && stats.error === undefined && typeof stats.head === "string";

  return (
    <footer className="border-t border-zinc-800 py-8">
      <div className="mx-auto max-w-5xl px-6 font-mono text-xs leading-relaxed text-zinc-600">
        <p>
          Every signal on mantel links to its source. Claims are auditable, not asserted.
        </p>
        {live ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                stats.verified ? "bg-emerald-500" : "bg-red-500"
              }`}
              aria-hidden
            />
            <span className={stats.verified ? "text-emerald-600" : "text-red-500"}>
              {stats.verified ? "tamper-evident" : "VERIFY FAILED"}
            </span>
            <span>· seq {stats.seq}</span>
            <span>· head {String(stats.head).slice(0, 12)}…</span>
            <span>· nedb-engine {stats.version} embedded</span>
          </p>
        ) : null}
        <p className="mt-1.5">© INTERCHAINED LLC · GPLv3</p>
      </div>
    </footer>
  );
}
