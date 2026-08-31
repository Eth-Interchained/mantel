/**
 * The derived-identity hook — mantel's whole "account" system, client-side.
 *
 * Holds the current identity (recalled from localStorage on mount) and exposes
 * sign-in (derive from nickname + salt) and sign-out. The salt is used only to
 * derive, in the browser, and is never stored or sent — recallIdentity brings
 * back the hash + handle, never the salt, so a returning visitor must re-enter
 * the salt to post again. That is the design, not a gap.
 */

import { useCallback, useEffect, useState } from "react";

import {
  deriveIdentity,
  forgetIdentity,
  recallIdentity,
  rememberIdentity,
  type DerivedIdentity,
} from "./identity";

export interface IdentityState {
  identity: DerivedIdentity | null;
  /** Derive + remember from a nickname and salt. Throws on invalid input;
   *  the caller shows the message. */
  signIn: (nickname: string, salt: string) => DerivedIdentity;
  signOut: () => void;
}

export function useIdentity(): IdentityState {
  const [identity, setIdentity] = useState<DerivedIdentity | null>(null);

  useEffect(() => {
    setIdentity(recallIdentity());
  }, []);

  const signIn = useCallback((nickname: string, salt: string): DerivedIdentity => {
    // deriveIdentity throws on a bad nickname or empty salt — let it propagate
    // so the form surfaces the exact reason instead of silently doing nothing.
    const id = deriveIdentity(nickname, salt);
    rememberIdentity(id);
    setIdentity(id);
    return id;
  }, []);

  const signOut = useCallback(() => {
    forgetIdentity();
    setIdentity(null);
  }, []);

  return { identity, signIn, signOut };
}
