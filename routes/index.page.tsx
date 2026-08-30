import React, { useEffect, useMemo, useState } from "react";

import { listModels, type ModelRow } from "../src/lib/api";
import { fitBadge, type ClientFitStatus } from "../src/lib/fitBadge";

export const intent = {
  purpose:
    "Search local models by what they are for and whether they fit your hardware; every claim carries a source",
  primaryAction: "Search models",
  seoKeyword: "local LLM VRAM requirements directory",
};

const STATUS_COPY: Record<ClientFitStatus, string> = {
  fits: "fits",
  tight: "tight",
  "too-big": "too big",
  unknown: "unmeasured",
};

/** The VRAM box: type a number, the list re-badges. No account, no submit. */
function VramInput({
  vram,
  onChange,
}: {
  vram: number | null;
  onChange: (v: number | null) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="font-mono text-zinc-500">your VRAM</span>
      <span className="flex items-center rounded border border-zinc-700 bg-zinc-900 focus-within:border-cyan-500">
        <input
          type="number"
          min={1}
          max={512}
          inputMode="numeric"
          value={vram ?? ""}
          placeholder="24"
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(e.target.value === "" || !Number.isFinite(n) || n <= 0 ? null : n);
          }}
          className="w-20 bg-transparent px-3 py-1.5 font-mono text-zinc-100 outline-none"
          aria-label="Your available VRAM in gigabytes"
        />
        <span className="pr-3 font-mono text-xs text-zinc-500">GiB</span>
      </span>
    </label>
  );
}

function ModelCard({ model, vram }: { model: ModelRow; vram: number | null }): React.ReactElement {
  const badge = fitBadge(model.quants ?? [], vram);
  return (
    <li className="border-b border-zinc-800 py-5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <a
          href={`/m/${encodeURIComponent(model._id)}`}
          className="font-mono text-lg text-cyan-400 underline-offset-4 hover:underline"
        >
          {model._id}
        </a>
        {model.params ? <span className="font-mono text-xs text-zinc-500">{model.params}</span> : null}
        {model.license ? <span className="font-mono text-xs text-zinc-600">{model.license}</span> : null}
        <span
          className={`ml-auto rounded px-2 py-0.5 font-mono text-xs ${badge.className}`}
          title={badge.title}
        >
          {STATUS_COPY[badge.status]}
          {badge.quant ? ` · ${badge.quant}` : ""}
        </span>
      </div>

      {model.summary ? (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{model.summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(model.tags ?? []).slice(0, 6).map((t) => (
          <span
            key={t}
            className="rounded-sm border border-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500"
          >
            {t}
          </span>
        ))}
        {badge.unmeasured > 0 ? (
          <span className="font-mono text-[11px] text-amber-600/80">
            {badge.unmeasured} quant{badge.unmeasured === 1 ? "" : "s"} unmeasured
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default function Home(): React.ReactElement {
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [vram, setVram] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listModels()
      .then((r) => {
        if (alive) setModels(r.models);
      })
      .catch((err: unknown) => {
        // Never leave a blank list that reads as "no models exist".
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!models) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (m) =>
        m._id.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
    );
  }, [models, q]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <span className="font-mono text-lg text-amber-500">▚</span>
          <span className="font-mono text-lg tracking-tight">mantel</span>
          <span className="hidden font-mono text-xs text-zinc-600 sm:inline">the hearthboard</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="border-b border-zinc-800 py-12">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            Will it run on your box, and is it any good?
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-zinc-400">
            Every model directory gives you a name and a file size. mantel gives you the VRAM
            math, what real people said after running it, and a link to the post they said it in.
            No signup. No estimates dressed up as facts.
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search models, e.g. coder, reasoning, qwen"
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-4 py-2.5 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
              aria-label="Search models"
            />
            <VramInput vram={vram} onChange={setVram} />
          </div>
          {vram === null ? (
            <p className="mt-3 font-mono text-xs text-zinc-600">
              enter your VRAM to see fit badges — until then we do not guess
            </p>
          ) : null}
        </section>

        <section className="py-8">
          {error ? (
            <div className="rounded border border-red-900/60 bg-red-950/30 p-4">
              <p className="font-mono text-sm text-red-400">could not load the catalog</p>
              <p className="mt-1 font-mono text-xs text-red-400/70">{error}</p>
            </div>
          ) : models === null ? (
            <p className="font-mono text-sm text-zinc-600">loading catalog…</p>
          ) : shown.length === 0 ? (
            <p className="font-mono text-sm text-zinc-500">
              {models.length === 0
                ? "the catalog is empty — nothing has been ingested yet"
                : `no model matches “${q}”`}
            </p>
          ) : (
            <>
              <p className="mb-2 font-mono text-xs text-zinc-600">
                {shown.length} model{shown.length === 1 ? "" : "s"}
                {vram !== null ? ` · badged against ${vram} GiB` : ""}
              </p>
              <ul>
                {shown.map((m) => (
                  <ModelCard key={m._id} model={m} vram={vram} />
                ))}
              </ul>
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-8">
        <div className="mx-auto max-w-5xl px-6 font-mono text-xs leading-relaxed text-zinc-600">
          <p>
            mantel stores every signal with a link to its source. Claims are auditable, not
            asserted.
          </p>
          <p className="mt-1">© INTERCHAINED LLC · GPLv3</p>
        </div>
      </footer>
    </div>
  );
}
