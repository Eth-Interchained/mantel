import React, { useCallback, useMemo, useState } from "react";

import { setSession } from "../lib/api";
import { greetingName, markWelcome } from "../lib/welcome";
import {
  deriveAccount,
  generatePhrase,
  normalizePhrase,
  shortAddress,
  signMessage,
  validatePhrase,
} from "../lib/wallet";

/**
 * The account surface — education first.
 *
 * Most people have never held a seed phrase. This component teaches the
 * model while onboarding: twelve words ARE the account, written on
 * paper, never sent anywhere. No email, no password, no reset desk.
 * The phrase is generated in this browser, signs one login message,
 * and is forgotten the moment the session starts.
 */

type Step = "welcome" | "create" | "confirm" | "import" | "signing";

async function loginWithPhrase(phrase: string, kind: "new" | "back"): Promise<string> {
  const { address } = await deriveAccount(phrase);
  let chalRes: Response;
  try {
    chalRes = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch {
    // fetch() rejected — the server is unreachable (not an HTTP error).
    // Raw "Failed to fetch" is useless to a human; say what to check.
    throw new Error(
      "Can't reach the server. Your words are fine — the connection isn't. Try again in a moment (self-hosting? check the api process).",
    );
  }
  if (!chalRes.ok) throw new Error("could not start sign-in — is the server up?");
  const chal = (await chalRes.json()) as { challengeId: string; message: string };
  const signature = await signMessage(phrase, chal.message);
  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: chal.challengeId, address, signature }),
  });
  if (!verifyRes.ok) {
    const j = (await verifyRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "sign-in failed");
  }
  const session = (await verifyRes.json()) as { token: string };
  // Mark BEFORE setSession — setSession dispatches the session event,
  // and the welcome toast reads the mark inside that very dispatch.
  markWelcome(kind, greetingName(null, address));
  setSession(session.token, address);
  return address;
}

function pickThree(): [number, number, number] {
  const all = Array.from({ length: 12 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return [all[0], all[1], all[2]].sort((a, b) => a - b) as [number, number, number];
}

export function AccountGate({ onReady }: { onReady: () => void }): React.ReactElement {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A fresh phrase per mount — regenerated if the user backs out.
  const [phrase, setPhrase] = useState<string>("");
  const words = useMemo(() => (phrase ? phrase.split(" ") : []), [phrase]);
  const [checkIdx, setCheckIdx] = useState<[number, number, number]>([0, 3, 7]);
  const [checks, setChecks] = useState<[string, string, string]>(["", "", ""]);
  const [importText, setImportText] = useState("");

  const startCreate = useCallback(() => {
    const p = generatePhrase();
    setPhrase(p);
    setCheckIdx(pickThree());
    setChecks(["", "", ""]);
    setError(null);
    setStep("create");
  }, []);

  const finishLogin = useCallback(
    async (p: string) => {
      setStep("signing");
      setError(null);
      try {
        // Same discriminator the error path uses: the freshly generated
        // phrase means a brand-new account; anything else is a return.
        const address = await loginWithPhrase(p, p === phrase ? "new" : "back");
        // The phrase leaves memory here. Only the session remains.
        setPhrase("");
        setImportText("");
        console.info(`[links] signed in as ${shortAddress(address)}`);
        onReady();
      } catch (err) {
        setError(err instanceof Error ? err.message : "sign-in failed");
        setStep(p === phrase ? "confirm" : "import");
      }
    },
    [onReady, phrase],
  );

  const confirmAndCreate = useCallback(() => {
    const ok = checkIdx.every(
      (wordIndex, i) => checks[i].trim().toLowerCase() === words[wordIndex],
    );
    if (!ok) {
      setError("Those words don't match — check your backup and try again.");
      return;
    }
    void finishLogin(phrase);
  }, [checkIdx, checks, words, phrase, finishLogin]);

  const copyPhrase = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — words are visible to copy manually */
    }
  }, [phrase]);

  const card = "panel p-6 sm:p-8";
  const primaryBtn = "btn btn-primary w-full !py-3.5";
  const ghostBtn = "btn btn-accent-ghost w-full !py-3";
  const backBtn = "mt-3 w-full text-sm text-fg-subtle hover:text-fg-muted transition";

  if (step === "welcome") {
    return (
      <div className={`${card} max-w-lg mx-auto mt-10 animate-fade-in`}>
        <p className="font-mono text-xs uppercase tracking-widest text-accent-soft text-center">
          your account is twelve words
        </p>
        <h2 className="font-display text-3xl font-bold mt-2 text-center">
          No email. No password.
          <br />
          Just your words.
        </h2>
        <ul className="mt-6 grid gap-3 text-sm text-fg-muted">
          <li className="flex gap-3">
            <span className="text-accent shrink-0">✓</span>
            <span>
              <b>Nothing to leak, nothing to spam.</b> We never ask for an email or
              phone number — there's no contact list to lose.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-accent shrink-0">✎</span>
            <span>
              <b>Twelve words are the only key.</b> Write them on paper and keep it
              somewhere safe — like the spare key to your house.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-signal-amber shrink-0">!</span>
            <span>
              <b>Nobody can reset them — not even us.</b> Lose the words, lose the
              account. That's exactly what makes it <i>yours</i>.
            </span>
          </li>
        </ul>
        <div className="mt-7 grid gap-2">
          <button onClick={startCreate} className={primaryBtn}>
            Create my twelve words
          </button>
          <button onClick={() => { setError(null); setStep("import"); }} className={ghostBtn}>
            I already have my words
          </button>
        </div>
        <p className="mt-5 text-[11px] text-fg-subtle text-center">
          Your words are generated in this browser and never leave it. The server only
          ever sees your public address.
        </p>
      </div>
    );
  }

  if (step === "create") {
    return (
      <div className={`${card} max-w-lg mx-auto mt-10 animate-fade-in`}>
        <p className="font-mono text-xs uppercase tracking-widest text-accent-soft text-center">
          step 1 of 2 — write these down
        </p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">
          Your twelve words, in order
        </h2>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {words.map((w, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 bg-ink-850 border border-ink-700 rounded-lg px-3 py-2"
            >
              <span className="font-mono text-[10px] text-fg-subtle">{i + 1}</span>
              <span className="font-mono text-sm text-fg">{w}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-xs text-signal-amber">
          Paper beats cloud: write them down physically. Anyone with these words IS
          you — and without them, no one can bring the account back.
        </div>
        <div className="mt-5 grid gap-2">
          <button onClick={copyPhrase} className={ghostBtn}>
            {copied ? "✓ copied" : "Copy words"}
          </button>
          <button onClick={() => { setError(null); setStep("confirm"); }} className={primaryBtn}>
            I wrote them down →
          </button>
        </div>
        <button onClick={() => setStep("welcome")} className={backBtn}>
          ← back
        </button>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className={`${card} max-w-lg mx-auto mt-10 animate-fade-in`}>
        <p className="font-mono text-xs uppercase tracking-widest text-accent-soft text-center">
          step 2 of 2 — prove the backup
        </p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">
          Three words from your paper
        </h2>
        <p className="text-fg-muted text-sm text-center mt-2">
          This is the moment that saves people. Check the paper, not your memory.
        </p>
        <div className="mt-5 grid gap-3">
          {checkIdx.map((wordIndex, i) => (
            <div key={wordIndex}>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-fg-subtle mb-1">
                word #{wordIndex + 1}
              </label>
              <input
                value={checks[i]}
                onChange={(e) =>
                  setChecks((c) => {
                    const next = [...c] as [string, string, string];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                autoFocus={i === 0}
                autoComplete="off"
                className="w-full bg-ink-850 border border-ink-700 rounded-xl px-4 py-3 outline-none focus:border-accent/60 text-fg font-mono"
              />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-signal-red text-sm text-center font-mono">{error}</p>}
        <button
          onClick={confirmAndCreate}
          disabled={checks.some((c) => !c.trim())}
          className={`mt-5 ${primaryBtn}`}
        >
          Create my account
        </button>
        <button onClick={() => { setError(null); setStep("create"); }} className={backBtn}>
          ← show my words again
        </button>
      </div>
    );
  }

  if (step === "import") {
    const normalized = normalizePhrase(importText);
    const valid = validatePhrase(normalized);
    return (
      <div className={`${card} max-w-lg mx-auto mt-10 animate-fade-in`}>
        <p className="font-mono text-xs uppercase tracking-widest text-accent-soft text-center">
          welcome back
        </p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">
          Enter your twelve words
        </h2>
        <p className="text-fg-muted text-sm text-center mt-2">
          In order, separated by spaces. They stay in this browser.
        </p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="word1 word2 word3 …"
          autoFocus
          rows={3}
          className="mt-5 w-full bg-ink-850 border border-ink-700 rounded-xl px-4 py-3 outline-none focus:border-accent/60 text-fg font-mono text-sm"
        />
        {importText.trim() && !valid && (
          <p className="mt-2 text-signal-amber text-xs font-mono">
            that's not a valid twelve-word phrase yet
          </p>
        )}
        {error && <p className="mt-3 text-signal-red text-sm text-center font-mono">{error}</p>}
        <button
          onClick={() => void finishLogin(normalized)}
          disabled={!valid}
          className={`mt-4 ${primaryBtn}`}
        >
          Sign in
        </button>
        <button onClick={() => { setError(null); setStep("welcome"); }} className={backBtn}>
          ← back
        </button>
      </div>
    );
  }

  // signing
  return (
    <div className={`${card} max-w-lg mx-auto mt-10 text-center animate-fade-in`}>
      <p className="font-mono text-xs uppercase tracking-widest text-accent-soft">
        signing you in
      </p>
      <p className="text-fg-muted text-sm mt-3">
        Your words are signing one login message — they never leave this device.
      </p>
    </div>
  );
}
