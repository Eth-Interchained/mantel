import React, { useCallback, useState } from "react";

import { setSession } from "../lib/api";
import { greetingName, markWelcome } from "../lib/welcome";

/**
 * The email-mode account surface — deliberately boring, deliberately
 * trustworthy. Sign in, sign up, forgot password: the flows everyone
 * already knows, styled like the rest of the studio. No seed phrases,
 * no addresses, no crypto vocabulary — that's the other product.
 */

type Step = "signin" | "signup" | "checkInbox" | "forgot" | "forgotSent" | "magicSent";

interface SessionResponse {
  token: string;
  address: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailGate({ onReady }: { onReady: () => void }): React.ReactElement {
  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  const post = useCallback(async (path: string, body: unknown): Promise<Response> => {
    try {
      return await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Can't reach the server — try again in a moment.");
    }
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post("/api/auth/login", { email: email.trim(), password });
      const j = (await r.json().catch(() => ({}))) as Partial<SessionResponse> & {
        error?: string;
        needsVerify?: boolean;
      };
      if (r.status === 403 && j.needsVerify) {
        setStep("checkInbox");
        setNotice("This account isn't confirmed yet — check your inbox for the link.");
        return;
      }
      if (!r.ok || !j.token) {
        setError(j.error ?? "sign-in failed");
        return;
      }
      // Mark BEFORE the session event fires (setSession dispatches it;
      // the toast reads the mark inside that very dispatch).
      markWelcome("back", greetingName(j.email ?? email.trim(), null));
      setSession(j.token, j.address ?? "", j.email ?? email.trim());
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign-in failed");
    } finally {
      setBusy(false);
    }
  }, [email, password, post, onReady]);

  const signUp = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post("/api/auth/signup", { email: email.trim(), password });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? "sign-up failed");
        return;
      }
      setNotice(null);
      setStep("checkInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign-up failed");
    } finally {
      setBusy(false);
    }
  }, [email, password, post]);

  const forgot = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/forgot", { email: email.trim() });
      setStep("forgotSent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }, [email, post]);

  const [code, setCode] = useState("");

  const requestMagic = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/magic", { email: email.trim() });
      setCode("");
      setStep("magicSent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }, [email, post]);

  const redeemCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post("/api/auth/magic-redeem", { email: email.trim(), code: code.trim() });
      const j = (await r.json().catch(() => ({}))) as Partial<SessionResponse> & { error?: string };
      if (!r.ok || !j.token) {
        setError(j.error ?? "that code didn't work");
        return;
      }
      // Mark before setSession — see signIn.
      markWelcome("back", greetingName(j.email ?? email.trim(), null));
      setSession(j.token, j.address ?? "", j.email ?? email.trim());
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign-in failed");
    } finally {
      setBusy(false);
    }
  }, [email, code, post, onReady]);

  const resend = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/resend-verify", { email: email.trim() });
      setNotice("Sent — give it a minute, and check spam just in case.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "resend failed");
    } finally {
      setBusy(false);
    }
  }, [email, post]);

  const card = "panel p-6 sm:p-8 max-w-md mx-auto mt-10 animate-fade-in";
  const primaryBtn = "btn btn-primary w-full !py-3";
  const linkBtn = "text-sm font-medium text-accent-soft hover:underline underline-offset-4";

  // ── Check-your-inbox (post-signup / unverified sign-in) ────────────────────
  if (step === "checkInbox") {
    return (
      <div className={card}>
        <p className="kicker text-center">one more step</p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">Check your inbox</h2>
        <p className="text-fg-muted text-sm text-center mt-3">
          We sent a confirmation link to
          <br />
          <b className="text-fg">{email.trim()}</b>
        </p>
        <p className="text-fg-subtle text-xs text-center mt-3">
          One click and you're in. The link expires in 30 minutes.
        </p>
        {notice && <p className="mt-3 text-signal-green text-xs text-center">{notice}</p>}
        {error && <p className="mt-3 text-signal-red text-xs text-center">{error}</p>}
        <button onClick={() => void resend()} disabled={busy} className="btn btn-secondary w-full !py-2.5 mt-5">
          {busy ? "Sending…" : "Resend the email"}
        </button>
        <button onClick={() => { setStep("signin"); setError(null); setNotice(null); }} className={`${linkBtn} block mx-auto mt-4`}>
          ← Back to sign in
        </button>
      </div>
    );
  }

  // ── Magic link sent — tap the email, or type the code here ─────────────────
  if (step === "magicSent") {
    return (
      <div className={card}>
        <p className="kicker text-center">check your inbox</p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">Your link is on its way</h2>
        <p className="text-fg-muted text-sm text-center mt-3">
          Tap the button in the email we sent to
          <br />
          <b className="text-fg">{email.trim()}</b>
        </p>
        <p className="text-fg-subtle text-xs text-center mt-4">
          On another device? Type the 6-digit code from the email:
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="field mt-2 text-center !text-2xl tracking-[0.5em] font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 6 && !busy) void redeemCode();
          }}
        />
        {error && <p className="mt-3 text-signal-red text-xs text-center">{error}</p>}
        <button
          onClick={() => void redeemCode()}
          disabled={busy || code.length !== 6}
          className={`${primaryBtn} mt-4`}
        >
          {busy ? "Signing in…" : "Sign in with code"}
        </button>
        <button onClick={() => { setStep("signin"); setError(null); }} className={`${linkBtn} block mx-auto mt-4`}>
          ← Back to sign in
        </button>
      </div>
    );
  }

  // ── Forgot password ─────────────────────────────────────────────────────────
  if (step === "forgot" || step === "forgotSent") {
    return (
      <div className={card}>
        <p className="kicker text-center">password reset</p>
        <h2 className="font-display text-2xl font-bold mt-2 text-center">
          {step === "forgotSent" ? "Check your inbox" : "Forgot your password?"}
        </h2>
        {step === "forgotSent" ? (
          <>
            <p className="text-fg-muted text-sm text-center mt-3">
              If an account exists for <b className="text-fg">{email.trim()}</b>, a reset
              link is on its way. It expires in 30 minutes.
            </p>
            <button onClick={() => { setStep("signin"); setError(null); }} className={`${linkBtn} block mx-auto mt-6`}>
              ← Back to sign in
            </button>
          </>
        ) : (
          <>
            <p className="text-fg-muted text-sm text-center mt-3">
              No drama — enter your email and we'll send a reset link.
            </p>
            <label className="label mt-5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              className="field"
            />
            {error && <p className="mt-3 text-signal-red text-xs text-center">{error}</p>}
            <button onClick={() => void forgot()} disabled={busy || !emailValid} className={`${primaryBtn} mt-5`}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button onClick={() => { setStep("signin"); setError(null); }} className={`${linkBtn} block mx-auto mt-4`}>
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Sign in / sign up ───────────────────────────────────────────────────────
  const signup = step === "signup";
  return (
    <div className={card}>
      <p className="kicker text-center">
        {signup ? "create your account" : "welcome back"}
      </p>
      <h2 className="font-display text-2xl font-bold mt-2 text-center">
        {signup ? "One handle. Every surface." : "Sign in"}
      </h2>
      {signup && (
        <p className="text-fg-muted text-sm text-center mt-2">
          Your first profile is free, forever. No spam — we only email you about
          things <i>you</i> do.
        </p>
      )}

      <label className="label mt-6">Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoFocus
        className="field"
      />

      <label className="label mt-4">Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={signup ? "at least 8 characters" : "your password"}
        className="field"
        onKeyDown={(e) => {
          if (e.key === "Enter" && emailValid && password.length >= 8 && !busy) {
            void (signup ? signUp() : signIn());
          }
        }}
      />
      {!signup && (
        <button onClick={() => { setStep("forgot"); setError(null); }} className={`${linkBtn} block ml-auto mt-2 !text-xs`}>
          Forgot password?
        </button>
      )}

      {error && <p className="mt-3 text-signal-red text-xs text-center">{error}</p>}

      <button
        onClick={() => void (signup ? signUp() : signIn())}
        disabled={busy || !emailValid || password.length < 8}
        className={`${primaryBtn} ${signup ? "mt-5" : "mt-4"}`}
      >
        {busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>

      {!signup && (
        <button
          onClick={() => void requestMagic()}
          disabled={busy || !emailValid}
          className="btn btn-secondary w-full !py-2.5 mt-2"
          title={emailValid ? "We'll email you a one-tap sign-in link and a code" : "Enter your email first"}
        >
          ✨ Email me a sign-in link instead
        </button>
      )}

      <p className="text-fg-subtle text-xs text-center mt-5">
        {signup ? (
          <>
            Already have an account?{" "}
            <button onClick={() => { setStep("signin"); setError(null); }} className={linkBtn}>
              Sign in
            </button>
          </>
        ) : (
          <>
            New here?{" "}
            <button onClick={() => { setStep("signup"); setError(null); }} className={linkBtn}>
              Create an account
            </button>
          </>
        )}
      </p>
    </div>
  );
}
