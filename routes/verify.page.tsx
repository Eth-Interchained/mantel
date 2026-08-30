import React, { useCallback, useEffect, useRef, useState } from "react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { setSession } from "../src/lib/api";
import { greetingName, markWelcome } from "../src/lib/welcome";

export const intent = {
  purpose: "Email confirmation landing — redeems the verify token and signs the user in",
  primaryAction: "Confirm email",
  seoKeyword: "verify email",
};

/**
 * Where the "Confirm my email" button lands. Redeems the single-use
 * token, starts the session, and moves on — the happy path should feel
 * like one continuous motion from inbox to product.
 */

type State = "working" | "done" | "failed";

export default function VerifyPage(): React.ReactElement {
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // strict-mode double-mount guard — tokens are single-use
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("failed");
      setError("This link is missing its token — use the button in the email.");
      return;
    }
    void (async () => {
      try {
        const r = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const j = (await r.json().catch(() => ({}))) as {
          token?: string;
          address?: string;
          email?: string;
          error?: string;
        };
        if (!r.ok || !j.token) {
          setState("failed");
          setError(j.error ?? "verification failed");
          return;
        }
        setSession(j.token, j.address ?? "", j.email);
        // A confirmed email is the account's FIRST session — you only
        // arrive somewhere once, so this says "Welcome to", not back.
        // Marked AFTER setSession on purpose: this page navigates away,
        // so the mark must survive to greet on the destination — unlike
        // the same-page gates, which mark before so the session event
        // carries the toast immediately.
        markWelcome("new", greetingName(j.email ?? null, j.address ?? null));
        setState("done");
        setTimeout(() => {
          window.location.href = "/";
        }, 1400);
      } catch {
        setState("failed");
        setError("Can't reach the server — try the link again in a moment.");
      }
    })();
  }, []);

  const resend = useCallback(async () => {
    try {
      await fetch("/api/auth/resend-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resendEmail.trim() }),
      });
      setResent(true);
    } catch {
      /* the notice below stays honest either way */
    }
  }, [resendEmail]);

  return (
    <>
      <Nav />
      <main className="max-w-md mx-auto px-5 py-16">
        <div className="panel p-6 sm:p-8 text-center animate-fade-in">
          {state === "working" && (
            <>
              <p className="kicker">confirming</p>
              <h1 className="font-display text-2xl font-bold mt-2">One second…</h1>
              <p className="text-fg-muted text-sm mt-3">Checking your confirmation link.</p>
            </>
          )}
          {state === "done" && (
            <>
              <p className="kicker">confirmed</p>
              <h1 className="font-display text-2xl font-bold mt-2">You're in ✓</h1>
              <p className="text-fg-muted text-sm mt-3">
                Email confirmed and signed in. Taking you to claim your handle…
              </p>
            </>
          )}
          {state === "failed" && (
            <>
              <p className="kicker">hmm</p>
              <h1 className="font-display text-2xl font-bold mt-2">That link didn't work</h1>
              <p className="text-fg-muted text-sm mt-3">{error}</p>
              <p className="text-fg-subtle text-xs mt-2">
                Links expire after 30 minutes and work once. Enter your email and
                we'll send a fresh one.
              </p>
              {resent ? (
                <p className="mt-5 text-signal-green text-sm">
                  Sent — check your inbox (and spam, just in case).
                </p>
              ) : (
                <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="field"
                  />
                  <button
                    onClick={() => void resend()}
                    disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendEmail.trim())}
                    className="btn btn-primary !py-2"
                  >
                    Resend
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
