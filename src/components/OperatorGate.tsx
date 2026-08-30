import React, { useState } from "react";
import { KeyRound, Lock } from "lucide-react";

import { unlockOperator } from "../lib/api";

/**
 * The operator gate — its own auth, deliberately unrelated to login.
 *
 * Mark's call, 2026-08-22: "hide the admin under a gate with nothing to
 * do with login, its own auth." So this shares nothing with the account
 * system — no session, no email, no password, no user record. The
 * console is unlocked by POSSESSING the instance key, which is the
 * honest model: whoever runs the server has it, and nobody else should.
 *
 * Two details that matter more than they look:
 *
 *   1. The key is VERIFIED against the real endpoint before it is
 *      stored. A wrong paste says so immediately instead of being
 *      persisted and failing silently on every subsequent load.
 *
 *   2. It lives in its own storage slot and is attached only to
 *      /api/admin/*. Sharing the session slot would mean unlocking the
 *      console logs you out of your own account — and worse, would send
 *      a role-check-bypassing credential on every ordinary request.
 */
export function OperatorGate({ onUnlocked }: { onUnlocked: () => void }): React.ReactElement {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setBad(false);
    const ok = await unlockOperator(key);
    setBusy(false);
    if (ok) {
      setKey("");
      onUnlocked();
    } else {
      setBad(true);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto panel p-6 sm:p-8 mt-10">
      <span className="w-10 h-10 rounded-2xl bg-accent/10 text-accent-soft inline-flex items-center justify-center">
        <Lock size={18} />
      </span>
      <h2 className="font-display text-2xl mt-4">Operator console</h2>
      <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">
        This is locked with the instance key, not an account. Paste it to unlock.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-5">
        <label className="label">Instance key</label>
        <div className="flex items-center gap-2 bg-ink-850 border border-ink-800 rounded-2xl px-4 py-3">
          <KeyRound size={15} className="text-fg-subtle shrink-0" />
          <input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setBad(false);
            }}
            placeholder="LINKS_ADMIN_TOKEN"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-faint font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="btn btn-primary w-full !py-3 mt-4"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        {bad && (
          <p className="text-signal-red text-sm text-center mt-3">
            That key doesn&apos;t match this instance.
          </p>
        )}
        <p className="text-[11px] text-fg-subtle mt-4 leading-relaxed">
          It&apos;s the <code className="font-mono">LINKS_ADMIN_TOKEN</code> from the server&apos;s
          environment. Stored in this browser only, and sent only to the console&apos;s own
          endpoints — never with your ordinary requests.
        </p>
      </form>
    </div>
  );
}
