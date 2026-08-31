/**
 * The review composer — derive an identity, write a review, see it land.
 *
 * Two states: signed out (nickname + salt form) and signed in (the review
 * box). Both are deliberately plain. The salt field carries a warning that it
 * is unrecoverable, because that is true and hiding it would be dishonest.
 *
 * On submit it posts the derived HASH and handle — never the salt — to
 * /api/reviews. Errors (validation, rate limit) are surfaced verbatim; a
 * silent failure here would be indistinguishable from a broken endpoint.
 */

import React, { useState } from "react";

import type { SignalRow } from "./api";
import { useIdentity } from "./useIdentity";

const SENTIMENTS = ["positive", "mixed", "neutral", "negative"] as const;
type Sentiment = (typeof SENTIMENTS)[number];

async function postReview(input: {
  modelRef: string;
  identityHash: string;
  handle: string;
  body: string;
  sentiment: Sentiment;
  hardware?: string;
}): Promise<{ signalId: string; handle: string; postedAt: string }> {
  const r = await fetch("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    signalId?: string;
    handle?: string;
    postedAt?: string;
    error?: string;
    detail?: string;
  };
  if (!r.ok) {
    throw new Error(j.detail || j.error || `POST /api/reviews → ${r.status}`);
  }
  return { signalId: j.signalId ?? "", handle: j.handle ?? input.handle, postedAt: j.postedAt ?? "" };
}

function IdentityForm({
  onSignIn,
}: {
  onSignIn: (nickname: string, salt: string) => void;
}): React.ReactElement {
  const [nickname, setNickname] = useState("");
  const [salt, setSalt] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        write a review — no signup
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Your identity is derived from a nickname and a salt:{" "}
        <span className="font-mono text-zinc-300">nickname#hash</span>. We store the hash, never
        the salt. Re-enter the same pair anywhere and you are you again — lose the salt and that
        identity is gone. This is not a login; anyone with the pair can post as it.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="nickname"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
          aria-label="Nickname"
        />
        <input
          value={salt}
          onChange={(e) => setSalt(e.target.value)}
          type="password"
          placeholder="salt (a passphrase only you know)"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
          aria-label="Salt"
        />
        <button
          type="button"
          onClick={() => {
            try {
              setErr(null);
              onSignIn(nickname, salt);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
          className="rounded border border-cyan-700 bg-cyan-950/40 px-4 py-2 font-mono text-sm text-cyan-300 hover:bg-cyan-950/70"
        >
          derive
        </button>
      </div>
      {err ? <p className="mt-2 font-mono text-xs text-red-400">{err}</p> : null}
    </div>
  );
}

export function ReviewComposer({
  modelRef,
  onPosted,
}: {
  modelRef: string;
  onPosted: (signal: Partial<SignalRow>) => void;
}): React.ReactElement {
  const { identity, signIn, signOut } = useIdentity();
  const [body, setBody] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("positive");
  const [hardware, setHardware] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!identity) {
    return <IdentityForm onSignIn={signIn} />;
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-sm">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: `hsl(${identity.hue} 70% 55%)` }}
            aria-hidden
          />
          <span className="text-zinc-300">{identity.handle}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="font-mono text-xs text-zinc-600 hover:text-zinc-400"
        >
          sign out
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={`How does ${modelRef} actually run for you?`}
        className="mt-3 w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
        aria-label="Your review"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={sentiment}
          onChange={(e) => setSentiment(e.target.value as Sentiment)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-cyan-500"
          aria-label="Sentiment"
        >
          {SENTIMENTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={hardware}
          onChange={(e) => setHardware(e.target.value)}
          placeholder="hardware (optional) e.g. RTX 3090"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500"
          aria-label="Hardware"
        />
        <button
          type="button"
          disabled={busy || body.trim().length < 3}
          onClick={() => {
            setBusy(true);
            setErr(null);
            setOk(false);
            postReview({
              modelRef,
              identityHash: identity.hash,
              handle: identity.handle,
              body: body.trim(),
              sentiment,
              hardware: hardware.trim() || undefined,
            })
              .then((res) => {
                setOk(true);
                setBody("");
                onPosted({
                  _id: res.signalId,
                  modelRef,
                  source: "mantel",
                  authorHandle: res.handle,
                  excerpt: body.trim(),
                  sentiment,
                  hardware: hardware.trim() || undefined,
                  postedAt: res.postedAt,
                });
              })
              .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
          className="rounded border border-cyan-700 bg-cyan-950/40 px-4 py-1.5 font-mono text-xs text-cyan-300 hover:bg-cyan-950/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "posting…" : "post review"}
        </button>
      </div>

      {err ? <p className="mt-2 font-mono text-xs text-red-400">{err}</p> : null}
      {ok ? <p className="mt-2 font-mono text-xs text-emerald-400">posted — thanks.</p> : null}
    </div>
  );
}
