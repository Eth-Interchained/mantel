import React, { useCallback, useMemo, useState } from "react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { setSession } from "../src/lib/api";

export const intent = {
  purpose: "Password reset landing — redeems the reset token, sets a new password, signs in",
  primaryAction: "Set new password",
  seoKeyword: "reset password",
};

/**
 * Where the "Choose a new password" button lands. One field, one
 * confirm, one click — the reset also revokes every other session for
 * the account, so a stolen password dies here.
 */

export default function ResetPage(): React.ReactElement {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = password.length >= 8 && password === confirm;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        token?: string;
        address?: string;
        email?: string;
        error?: string;
      };
      if (!r.ok || !j.token) {
        setError(j.error ?? "reset failed");
        return;
      }
      setSession(j.token, j.address ?? "", j.email);
      setDone(true);
      setTimeout(() => {
        window.location.href = "/identities";
      }, 1400);
    } catch {
      setError("Can't reach the server — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [token, password]);

  return (
    <>
      <Nav />
      <main className="max-w-md mx-auto px-5 py-16">
        <div className="panel p-6 sm:p-8 animate-fade-in">
          {done ? (
            <div className="text-center">
              <p className="kicker">done</p>
              <h1 className="font-display text-2xl font-bold mt-2">Password updated ✓</h1>
              <p className="text-fg-muted text-sm mt-3">
                Every other session was signed out. Taking you to your identities…
              </p>
            </div>
          ) : !token ? (
            <div className="text-center">
              <p className="kicker">hmm</p>
              <h1 className="font-display text-2xl font-bold mt-2">Missing token</h1>
              <p className="text-fg-muted text-sm mt-3">
                Use the button in the reset email — or request a new link from the
                sign-in screen.
              </p>
            </div>
          ) : (
            <>
              <p className="kicker text-center">password reset</p>
              <h1 className="font-display text-2xl font-bold mt-2 text-center">
                Choose a new password
              </h1>
              <label className="label mt-6">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="at least 8 characters"
                autoFocus
                className="field"
              />
              <label className="label mt-4">Confirm it</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="same again"
                className="field"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid && !busy) void submit();
                }}
              />
              {confirm && password !== confirm && (
                <p className="mt-2 text-[11px] text-signal-amber">passwords don't match yet</p>
              )}
              {error && <p className="mt-3 text-signal-red text-xs text-center">{error}</p>}
              <button
                onClick={() => void submit()}
                disabled={busy || !valid}
                className="btn btn-primary w-full !py-3 mt-6"
              >
                {busy ? "Saving…" : "Set password & sign in"}
              </button>
              <p className="text-fg-subtle text-[11px] text-center mt-4">
                Setting a new password signs out every other session on this account.
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
