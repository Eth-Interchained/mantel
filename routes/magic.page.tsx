import React, { useEffect, useRef, useState } from "react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { setSession } from "../src/lib/api";
import { greetingName, markWelcome } from "../src/lib/welcome";

export const intent = {
  purpose: "Magic sign-in landing — redeems the emailed link token and starts the session",
  primaryAction: "Sign in",
  seoKeyword: "sign in link",
};

/**
 * Where the "Sign me in" button lands. Redeems the single-use link
 * token and moves on. Failed links point back to the sign-in screen,
 * where a fresh link (or the 6-digit code) is one tap away.
 */

type State = "working" | "done" | "failed";

export default function MagicPage(): React.ReactElement {
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // strict-mode guard — the token is single-use
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("failed");
      setError("This link is missing its token — use the button in the email.");
      return;
    }
    void (async () => {
      try {
        const r = await fetch("/api/auth/magic-redeem", {
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
          setError(j.error ?? "sign-in failed");
          return;
        }
        setSession(j.token, j.address ?? "", j.email);
        // Marked AFTER setSession — this page navigates to /identities,
        // so the mark must survive to greet there (see verify.page.tsx).
        markWelcome("back", greetingName(j.email ?? null, j.address ?? null));
        setState("done");
        setTimeout(() => {
          window.location.href = "/identities";
        }, 1200);
      } catch {
        setState("failed");
        setError("Can't reach the server — try the link again in a moment.");
      }
    })();
  }, []);

  return (
    <>
      <Nav />
      <main className="max-w-md mx-auto px-5 py-16">
        <div className="panel p-6 sm:p-8 text-center animate-fade-in">
          {state === "working" && (
            <>
              <p className="kicker">signing you in</p>
              <h1 className="font-display text-2xl font-bold mt-2">One second…</h1>
            </>
          )}
          {state === "done" && (
            <>
              <p className="kicker">welcome back</p>
              <h1 className="font-display text-2xl font-bold mt-2">You're in ✓</h1>
              <p className="text-fg-muted text-sm mt-3">Taking you to your identities…</p>
            </>
          )}
          {state === "failed" && (
            <>
              <p className="kicker">hmm</p>
              <h1 className="font-display text-2xl font-bold mt-2">That link didn't work</h1>
              <p className="text-fg-muted text-sm mt-3">{error}</p>
              <p className="text-fg-subtle text-xs mt-2">
                Links work once and expire after 15 minutes.
              </p>
              <a href="/" className="btn btn-primary w-full !py-2.5 mt-5">
                Back to sign in
              </a>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
