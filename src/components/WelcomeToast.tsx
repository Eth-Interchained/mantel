import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { onSessionChanged } from "../lib/api";
import { useAppConfig } from "../lib/useAppConfig";
import { takeWelcome, type WelcomeMark } from "../lib/welcome";

/**
 * The sign-in moment — "Welcome back, Marisa 👋", once per fresh
 * session, gone in four seconds. First-ever sessions (email verify)
 * get "Welcome to {brand}" instead: you only arrive somewhere once.
 *
 * Portaled to <body>: the nav's backdrop-blur creates a containing
 * block that would trap position:fixed descendants (the modal lesson,
 * still true for toasts).
 */
export function WelcomeToast(): React.ReactElement | null {
  const cfg = useAppConfig();
  const [mark, setMark] = useState<WelcomeMark | null>(null);
  const [leaving, setLeaving] = useState(false);

  const check = useCallback(() => {
    const m = takeWelcome();
    if (m) {
      setLeaving(false);
      setMark(m);
    }
  }, []);

  // On mount (login → full navigation) AND on session change (login on
  // this very page, e.g. the identities gate) — both roads get the wave.
  useEffect(() => {
    check();
    return onSessionChanged(check);
  }, [check]);

  useEffect(() => {
    if (!mark) return;
    const t1 = setTimeout(() => setLeaving(true), 4200);
    const t2 = setTimeout(() => setMark(null), 4600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [mark]);

  if (!mark) return null;
  const brand = cfg?.brandName ?? "NEDB Links";

  return createPortal(
    <div
      className="fixed inset-x-0 top-16 z-40 flex justify-center pointer-events-none px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto panel flex items-center gap-2.5 rounded-full !border-accent/40 bg-ink-900/95 px-4 py-2 shadow-lg shadow-black/40 transition-all duration-300 ${
          leaving ? "opacity-0 -translate-y-2" : ""
        }`}
        style={{ animation: "toast-in 0.35s ease both" }}
      >
        <span className="text-lg" aria-hidden>
          👋
        </span>
        <span className="text-sm font-semibold whitespace-nowrap">
          {mark.kind === "new" ? (
            <>
              Welcome to {brand}, <span className="text-accent-soft">{mark.name}</span>
            </>
          ) : (
            <>
              Welcome back, <span className="text-accent-soft">{mark.name}</span>
            </>
          )}
        </span>
      </div>
    </div>,
    document.body,
  );
}
