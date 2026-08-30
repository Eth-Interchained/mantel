/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./routes/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Per-theme via CSS vars: pro/native = Space Grotesk display,
        // v3 "signal" = Inter Tight display. Fallbacks live in the vars.
        sans:    ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        // Cards flex per theme (16px pro/native, 18px v3); controls 12px.
        "2xl": "var(--radius-card, 1rem)",
        xl:    "var(--radius-ctl, 0.75rem)",
      },
      colors: {
        // Surfaces + borders — both themes share these utilities;
        // the CSS variables decide what they mean.
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
        },
        // Text — semantic, never hardcode slate in components.
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted:   "rgb(var(--fg-muted) / <alpha-value>)",
          subtle:  "rgb(var(--fg-subtle) / <alpha-value>)",
          faint:   "rgb(var(--fg-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft:    "rgb(var(--accent-soft) / <alpha-value>)",
          glow:    "rgb(var(--accent-glow) / <alpha-value>)",
        },
        signal: {
          green: "#10b981",
          amber: "#d97706",
          red:   "#ef4444",
          cyan:  "#0891b2",
        },
      },
      boxShadow: {
        glow:     "0 0 0 1px rgb(var(--accent) / 0.18), 0 8px 40px -12px rgb(var(--accent) / var(--glow-alpha))",
        "glow-lg": "0 0 0 1px rgb(var(--accent) / 0.22), 0 20px 60px -15px rgb(var(--accent) / var(--glow-alpha))",
        card:     "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        pop:      "var(--shadow-pop)",
      },
      animation: {
        "fade-in":  "fade-in 0.4s ease both",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
      },
      keyframes: {
        "fade-in":  { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(20px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
