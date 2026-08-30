/**
 * App themes — four registers, one DOM.
 *   pro    — light, professional-network trust (default; normies first)
 *   native — sovereign dark, electric cyan (the crypto crowd)
 *   v3     — "Signal": the publishing studio. Editorial light, one strong
 *            blue, elevated cards, Inter Tight. Less dashboard, more app.
 *   mach   — silver slick at mach 5. Gunmetal + chrome, color as motion:
 *            streaming light trails, brushed metal, SpaceX elegance.
 *   kundli — warm porcelain. Near-white canvas, near-black ink, an
 *            Instrument Serif display over Outfit, ceramic-glass cards
 *            and a marigold accent. Sukuna's iKundli register (India).
 *
 * Persisted per browser; restored before first paint by index.html.
 */

export const THEME_ORDER = ["pro", "native", "v3", "mach", "kundli"] as const;
export type ThemeName = (typeof THEME_ORDER)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  pro: "○ pro",
  native: "◆ native",
  v3: "✦ signal",
  mach: "» mach",
  kundli: "❋ kundli",
};

export const THEME_KEY = "links-theme";

export function isThemeName(t: unknown): t is ThemeName {
  return typeof t === "string" && (THEME_ORDER as readonly string[]).includes(t);
}

/** Pure cycle: pro → native → v3 → mach → kundli → pro. Exported for tests. */
export function nextTheme(t: ThemeName): ThemeName {
  const i = THEME_ORDER.indexOf(t);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length];
}

/** The user's explicit pick, or null if they've never chosen. */
export function getStoredTheme(): ThemeName | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return isThemeName(t) ? t : null;
  } catch {
    return null;
  }
}

/** Deployment default injected by the server (prod) — absent in dev. */
function deploymentDefault(): ThemeName {
  try {
    const cfg = (window as unknown as { __LINKS_CONFIG__?: { defaultTheme?: string } })
      .__LINKS_CONFIG__;
    return isThemeName(cfg?.defaultTheme) ? cfg.defaultTheme : "pro";
  } catch {
    return "pro";
  }
}

export function getTheme(): ThemeName {
  return getStoredTheme() ?? deploymentDefault();
}

export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement;
  // 250ms crossfade — the transition class is scoped to the flip so the
  // rest of the app never pays for blanket transitions.
  root.classList.add("theme-fade");
  root.setAttribute("data-theme", theme);
  window.setTimeout(() => root.classList.remove("theme-fade"), 300);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — theme applies for this page only */
  }
}

export function toggleTheme(): ThemeName {
  const next = nextTheme(getTheme());
  applyTheme(next);
  return next;
}
