/**
 * The welcome moment — sign-in gets a *phase*, not just a state change.
 *
 * Gates mark the session start here (sessionStorage: survives the
 * redirect between "signed in" and "first paint", never a browser
 * restart); the toast takes the mark exactly once. Marisa's ask,
 * near-verbatim: clear login/logout phases + "Welcome back, {name}".
 */

const KEY = "links-welcome";

export type WelcomeKind = "back" | "new";

export interface WelcomeMark {
  kind: WelcomeKind;
  name: string;
}

export function markWelcome(kind: WelcomeKind, name: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ kind, name }));
  } catch {
    /* storage unavailable — the login still works, just quieter */
  }
}

/** Read-and-clear: the toast fires once per fresh sign-in, never on a
 *  refresh, never on back-nav. */
export function takeWelcome(): WelcomeMark | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const j = JSON.parse(raw) as Partial<WelcomeMark>;
    if (typeof j.name !== "string" || (j.kind !== "back" && j.kind !== "new")) return null;
    return { kind: j.kind, name: j.name };
  } catch {
    return null;
  }
}

/** "marisa.y@…" → "Marisa"; wallet sessions greet by short address;
 *  no session data at all greets like a good bartender. */
export function greetingName(email: string | null, address: string | null): string {
  if (email) {
    const local = email.split("@")[0] ?? "";
    const word = local.split(/[._+-]/)[0] ?? local;
    if (word) return word[0].toUpperCase() + word.slice(1);
  }
  if (address) return address.length <= 12 ? address : `${address.slice(0, 8)}…`;
  return "friend";
}

/** Time-of-day greeting — the dashboard reads the clock, because
 *  "Good evening, Marisa" lands warmer than a label ever will. */
export function daypartGreeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
