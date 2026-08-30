import React, { useEffect, useState } from "react";

import {
  getFit,
  getModelPage,
  type ModelFit,
  type ModelRow,
  type SignalRow,
} from "../../src/lib/api";
import { ReviewComposer } from "../../src/lib/ReviewComposer";
import { SentimentTimeline } from "../../src/lib/SentimentTimeline";

export const intent = {
  purpose:
    "One model: what it is, exactly what hardware runs it, and what real people reported — each with a link to the source post",
  primaryAction: "Copy the pull command",
  seoKeyword: "run model locally VRAM requirements reviews",
};

const SENTIMENT_CLASS: Record<string, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  mixed: "text-amber-400",
  neutral: "text-zinc-400",
};

const SOURCE_LABEL: Record<string, string> = {
  x: "X",
  bluesky: "Bluesky",
  reddit: "Reddit",
  hn: "Hacker News",
  hf: "HuggingFace",
  github: "GitHub",
  mantel: "mantel review",
};

const FIT_CLASS: Record<string, string> = {
  fits: "text-emerald-400",
  tight: "text-amber-400",
  "too-big": "text-red-400",
  unknown: "text-zinc-500",
};

/** npm's install box, for models. */
function PullBox({ pull }: { pull: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        // Clipboard can reject (permissions, insecure context). Say so instead
        // of flashing a success state that did nothing.
        navigator.clipboard
          .writeText(pull)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch((err: unknown) => {
            console.warn(
              `[mantel] clipboard write was rejected (${err instanceof Error ? err.message : String(err)}) — ` +
                "select the command and copy manually.",
            );
            window.prompt("Copy the pull command:", pull);
          });
      }}
      className="flex w-full items-center gap-3 rounded border border-zinc-700 bg-zinc-900 px-4 py-3 text-left font-mono text-sm hover:border-cyan-600"
      aria-label="Copy the pull command"
    >
      <span className="text-zinc-500">$</span>
      <span className="flex-1 truncate text-zinc-100">{pull}</span>
      <span className="text-xs text-zinc-500">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

function FitTable({ fits }: { fits: ModelFit[] }): React.ReactElement {
  return (
    <div className="space-y-4">
      {fits.map((f) => (
        <div key={f.profile.id} className="border-b border-zinc-800 pb-3 last:border-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm text-zinc-300">{f.profile.label}</span>
            <span className={`font-mono text-xs ${FIT_CLASS[f.best] ?? "text-zinc-500"}`}>
              {f.best === "unknown" ? "unmeasured" : f.best}
              {f.bestQuant ? ` · ${f.bestQuant}` : ""}
            </span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {f.quants.map((q) => (
              <li key={q.quant} className="flex items-baseline gap-2 font-mono text-[11px]">
                <span className="w-20 shrink-0 text-zinc-500">{q.quant}</span>
                <span className="w-16 shrink-0 text-zinc-600">{q.fileGib} GiB</span>
                <span className={FIT_CLASS[q.status] ?? "text-zinc-500"} title={q.reason}>
                  {q.status === "unknown" ? "unmeasured" : q.status}
                </span>
              </li>
            ))}
          </ul>
          {f.unmeasured > 0 ? (
            <p className="mt-1.5 font-mono text-[11px] text-amber-600/80">
              {f.unmeasured} quant{f.unmeasured === 1 ? "" : "s"} have no measured VRAM figure —
              file size is not a substitute
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SignalCard({ signal }: { signal: SignalRow }): React.ReactElement {
  return (
    <li className="border-b border-zinc-800 py-4 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs">
        <span className="text-zinc-500">{SOURCE_LABEL[signal.source] ?? signal.source}</span>
        {signal.authorHandle ? <span className="text-zinc-400">{signal.authorHandle}</span> : null}
        <span className={SENTIMENT_CLASS[signal.sentiment] ?? "text-zinc-400"}>
          {signal.sentiment}
        </span>
        {signal.hardware ? <span className="text-zinc-500">on {signal.hardware}</span> : null}
        <time className="ml-auto text-zinc-600" dateTime={signal.postedAt}>
          {signal.postedAt.slice(0, 10)}
        </time>
      </div>

      <blockquote className="mt-2 border-l-2 border-zinc-700 pl-3 text-sm leading-relaxed text-zinc-300">
        {signal.excerpt}
      </blockquote>

      <div className="mt-2 flex items-center gap-3 font-mono text-[11px]">
        {/* Native reviews carry a relative in-page anchor, not an external
            post — no "read the original ↗" for those, just the receipt. */}
        {signal.source !== "mantel" ? (
          <a
            href={signal.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-500 underline-offset-4 hover:underline"
          >
            read the original ↗
          </a>
        ) : (
          <span className="text-zinc-600">posted on mantel</span>
        )}
        <a
          href={`/api/models/${encodeURIComponent(signal.modelRef)}/signals/${encodeURIComponent(signal._id)}/trace`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-600 underline-offset-4 hover:underline"
          title="The provenance chain: this claim, and the captured document it came from"
        >
          receipt
        </a>
      </div>
    </li>
  );
}

export default function ModelPage(): React.ReactElement {
  // Portal routes by file path; read the id from the URL so this page works
  // regardless of which router shape is in play.
  const id = decodeURIComponent(
    typeof window === "undefined" ? "" : window.location.pathname.replace(/^\/m\//, ""),
  );

  const [data, setData] = useState<{
    model: ModelRow;
    signals: SignalRow[];
    sentiment: Record<string, number>;
  } | null>(null);
  // Signals are held separately from `data` so a freshly-posted review can be
  // prepended without a full refetch — the composer's optimistic append.
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [fits, setFits] = useState<ModelFit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getModelPage(id)
      .then((r) => {
        if (alive) {
          setData(r);
          setSignals(r.signals);
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    // Fit is a separate request, and a separate failure: a broken fit table
    // must not blank out the page's content, and must not look like "no data".
    getFit(id)
      .then((r) => {
        if (alive) setFits(r.fits);
      })
      .catch((err: unknown) => {
        if (alive) setFitError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
        <div className="mx-auto max-w-2xl">
          <p className="font-mono text-sm text-red-400">could not load {id || "this model"}</p>
          <p className="mt-1 font-mono text-xs text-red-400/70">{error}</p>
          <a href="/" className="mt-6 inline-block font-mono text-sm text-cyan-400 hover:underline">
            ← back to the catalog
          </a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-16">
        <p className="mx-auto max-w-2xl font-mono text-sm text-zinc-600">loading {id}…</p>
      </div>
    );
  }

  const { model } = data;
  // Recompute the tally from the live signal list so a just-posted review is
  // reflected in the counts without a refetch. Cheap at these sizes.
  const sentiment = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.sentiment] = (acc[s.sentiment] ?? 0) + 1;
    return acc;
  }, {});
  const total = signals.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <a href="/" className="font-mono text-lg text-amber-500">
            ▚
          </a>
          <a href="/" className="font-mono text-lg tracking-tight">
            mantel
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-10 lg:grid-cols-[1fr_18rem]">
        <div>
          <h1 className="font-mono text-2xl text-zinc-100 sm:text-3xl">{model._id}</h1>
          <p className="mt-1 text-zinc-400">{model.name}</p>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-zinc-500">
            {model.params ? <span>{model.params} params</span> : null}
            {model.arch ? <span>{model.arch}</span> : null}
            {model.license ? <span>{model.license}</span> : null}
            {model.contextNative ? (
              <span>{model.contextNative.toLocaleString()} ctx</span>
            ) : null}
          </div>

          {model.pull ? (
            <div className="mt-6">
              <PullBox pull={model.pull} />
            </div>
          ) : null}

          {model.summary ? (
            <p className="mt-6 max-w-2xl leading-relaxed text-zinc-300">{model.summary}</p>
          ) : null}

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-sm uppercase tracking-wider text-zinc-500">
                what people said
              </h2>
              <span className="font-mono text-xs text-zinc-600">
                {total} signal{total === 1 ? "" : "s"}
              </span>
            </div>

            {total > 0 ? (
              <div className="mt-3 flex flex-wrap gap-x-4 font-mono text-xs">
                {Object.entries(sentiment).map(([k, n]) => (
                  <span key={k} className={SENTIMENT_CLASS[k] ?? "text-zinc-400"}>
                    {k} {n}
                  </span>
                ))}
              </div>
            ) : null}

            {total > 0 ? <SentimentTimeline modelRef={model._id} /> : null}

            <div className="mt-4">
              <ReviewComposer
                modelRef={model._id}
                onPosted={(s) => {
                  // Optimistic prepend: dedupe by id so re-posting (which the
                  // server upserts) replaces rather than doubles the row.
                  setSignals((prev) => [
                    s as SignalRow,
                    ...prev.filter((p) => p._id !== s._id),
                  ]);
                }}
              />
            </div>

            {signals.length === 0 ? (
              <p className="mt-4 font-mono text-sm text-zinc-600">
                no signals ingested for this model yet — mantel shows nothing rather than
                filling the gap
              </p>
            ) : (
              <ul className="mt-4">
                {signals.map((s) => (
                  <SignalCard key={s._id} signal={s} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <h2 className="font-mono text-sm uppercase tracking-wider text-zinc-500">
            will it run
          </h2>
          <div className="mt-4">
            {fitError ? (
              <div className="rounded border border-red-900/60 bg-red-950/30 p-3">
                <p className="font-mono text-xs text-red-400">fit data unavailable</p>
                <p className="mt-1 font-mono text-[11px] text-red-400/70">{fitError}</p>
              </div>
            ) : fits === null ? (
              <p className="font-mono text-xs text-zinc-600">computing…</p>
            ) : (
              <FitTable fits={fits} />
            )}
          </div>

          {model.links && Object.values(model.links).some(Boolean) ? (
            <div className="mt-8">
              <h2 className="font-mono text-sm uppercase tracking-wider text-zinc-500">links</h2>
              <ul className="mt-3 space-y-1.5 font-mono text-xs">
                {model.links.hf ? (
                  <li>
                    <a
                      href={model.links.hf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-500 hover:underline"
                    >
                      HuggingFace ↗
                    </a>
                  </li>
                ) : null}
                {model.links.github ? (
                  <li>
                    <a
                      href={model.links.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-500 hover:underline"
                    >
                      GitHub ↗
                    </a>
                  </li>
                ) : null}
                {model.links.ollama ? (
                  <li>
                    <a
                      href={model.links.ollama}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-500 hover:underline"
                    >
                      Ollama ↗
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
