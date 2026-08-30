import React, { useEffect, useState } from "react";
import { Link } from "@interchained/portal-react";

import { useAppConfig } from "../lib/useAppConfig";
import { getTheme, nextTheme, THEME_LABELS, toggleTheme, type ThemeName } from "../lib/theme";

/**
 * The app footer — quiet, uniform, and now the home of the theme
 * switcher (moved out of the nav to keep the top bar lean on phones).
 * Brand mark · Discover · Terms · theme cycler, plus the craftsmen's
 * signature line. That's it.
 */
export function Footer(): React.ReactElement {
  const cfg = useAppConfig();
  const brand = cfg?.brandName ?? "NEDB Links";
  const [theme, setTheme] = useState<ThemeName>("pro");

  useEffect(() => {
    setTheme(getTheme());
  }, []);

  return (
    <footer className="mt-16 border-t border-ink-800 py-8">
      <div className="max-w-7xl mx-auto px-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 text-xs text-fg-subtle">
        <Link href="/" className="font-display font-bold text-fg-muted hover:text-fg transition inline-flex items-center gap-1.5" title={brand}>
          {cfg?.brandLogoUrl ? (
            <img src={cfg.brandLogoUrl} alt="" className="h-4 w-4 object-contain" />
          ) : (
            <span className="text-accent">⬡</span>
          )}
          {brand}
        </Link>
        <span className="h-3 w-px bg-ink-800" aria-hidden />
        <a href="/discover" className="font-medium hover:text-fg transition">
          Discover
        </a>
        <span className="h-3 w-px bg-ink-800" aria-hidden />
        {/* Server route (zero-JS page) — hard link, like Discover. */}
        <a href="/fair" className="font-medium hover:text-fg transition">
          Fair draws
        </a>
        <span className="h-3 w-px bg-ink-800" aria-hidden />
        <Link href="/terms" className="font-medium hover:text-fg transition">
          Terms
        </Link>
        <span className="h-3 w-px bg-ink-800" aria-hidden />
        <button
          onClick={() => setTheme(toggleTheme())}
          className="chip font-mono text-[10px] uppercase tracking-widest text-fg-subtle hover:text-accent-soft hover:border-accent/40 transition"
          title={`Theme: ${theme} — click for ${nextTheme(theme)}`}
        >
          {THEME_LABELS[theme]}
        </button>
      </div>
      {/* The craftsmen's mark — three of us built this, on the record. 3 > 1. */}
      <p className="mt-5 text-center font-mono text-[10px] tracking-wide text-fg-faint">
        © {new Date().getFullYear()} INTERCHAINED LLC · crafted 3&gt;1 — Mark × the Oracle × Vex
      </p>
    </footer>
  );
}
