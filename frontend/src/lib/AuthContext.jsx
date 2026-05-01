import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signInWithSolana, loadStoredAuth, clearAuth, saveAuth } from "./auth";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const wallet = useWallet();
  const [auth, setAuth] = useState(() => loadStoredAuth());
  const [signingIn, setSigningIn] = useState(false);

  // Re-validate the admin flag from the server once on mount (or whenever the
  // token changes) so that ADMIN_WALLETS edits on the server take effect
  // without the user having to sign in again. /auth/me is cheap and the
  // axios interceptor already attaches the bearer token.
  useEffect(() => {
    if (!auth?.token) return;
    let cancelled = false;
    api.get("/auth/me").then((r) => {
      if (cancelled) return;
      const fresh = !!r.data?.is_admin;
      if (fresh !== !!auth.isAdmin) {
        const next = { ...auth, isAdmin: fresh };
        saveAuth(next);
        setAuth(next);
      }
    }).catch(() => {
      // 401 etc. — the api interceptor already clears auth on 401.
    });
    return () => { cancelled = true; };
  }, [auth?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the wallet disconnects or the connected address no longer matches the
  // signed-in address, drop the JWT — it isn't usable anymore.
  useEffect(() => {
    if (!auth) return;
    const connectedAddr = wallet.publicKey?.toBase58();
    if (!connectedAddr || connectedAddr !== auth.address) {
      clearAuth();
      setAuth(null);
    }
  }, [wallet.publicKey, auth]);

  // Auto sign-in: as soon as a wallet connects (and we're not already signed
  // in for this address), kick off SIWS silently. The user approves in their
  // wallet popup — no extra button needed.
  useEffect(() => {
    const connectedAddr = wallet.publicKey?.toBase58();
    if (!connectedAddr) return;                        // not connected
    if (auth?.address === connectedAddr) return;       // already signed in
    if (signingIn) return;                             // already in progress
    if (!wallet.signMessage) return;                   // adapter not ready

    let cancelled = false;
    setSigningIn(true);
    signInWithSolana(wallet)
      .then((next) => { if (!cancelled) setAuth(next); })
      .catch(() => {})  // user rejected or locked wallet — silently ignore
      .finally(() => { if (!cancelled) setSigningIn(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.publicKey]);

  // Auto-expire on TTL
  useEffect(() => {
    if (!auth?.expiresAt) return;
    const ms = Date.parse(auth.expiresAt) - Date.now();
    if (ms <= 0) {
      clearAuth();
      setAuth(null);
      return;
    }
    const t = setTimeout(() => {
      clearAuth();
      setAuth(null);
    }, ms);
    return () => clearTimeout(t);
  }, [auth?.expiresAt]);

  const signIn = useCallback(async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      const next = await signInWithSolana(wallet);
      setAuth(next);
      return next;
    } finally {
      setSigningIn(false);
    }
  }, [wallet, signingIn]);

  const signOut = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  const value = useMemo(() => ({
    auth,
    isAuthenticated: !!auth?.token,
    isAdmin: !!(auth?.token && auth?.isAdmin),
    address: auth?.address || null,
    signIn,
    signOut,
    signingIn,
  }), [auth, signIn, signOut, signingIn]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
