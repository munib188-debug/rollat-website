import bs58 from "bs58";

const API_BASE = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const STORAGE_KEY = "rollat_auth_v1";

export function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.token || !obj?.address) return null;
    if (obj.expiresAt && Date.parse(obj.expiresAt) < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

export function saveAuth(auth) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {}
}

export function clearAuth() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

async function fetchNonce(address) {
  const r = await fetch(`${API_BASE}/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!r.ok) throw new Error(`nonce request failed (${r.status})`);
  return r.json();
}

async function postVerify(payload) {
  const r = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`verify failed (${r.status}): ${txt}`);
  }
  return r.json();
}

/**
 * Run the full SIWS flow:
 *   - request nonce + canonical message
 *   - ask wallet to sign the exact message bytes (UTF-8)
 *   - send signature to backend, receive JWT
 *
 * @param {{ publicKey: PublicKey, signMessage: (m: Uint8Array) => Promise<Uint8Array> }} wallet
 *        the @solana/wallet-adapter-react wallet object
 * @returns {Promise<{token: string, address: string, expiresAt: string}>}
 */
export async function signInWithSolana(wallet) {
  if (!wallet?.publicKey) throw new Error("Wallet not connected");
  if (typeof wallet.signMessage !== "function") {
    throw new Error("Wallet does not support message signing");
  }
  const address = wallet.publicKey.toBase58();
  const { nonce, message, expires_at: nonceExpires } = await fetchNonce(address);

  // Sanity check: refuse to sign anything that doesn't include the address + nonce we just got.
  // Defense against a hostile backend trying to make the user sign an unrelated payload.
  if (!message.includes(address) || !message.includes(nonce)) {
    throw new Error("Server returned a malformed sign-in message");
  }

  const encoded = new TextEncoder().encode(message);
  const sigBytes = await wallet.signMessage(encoded);
  const signature = bs58.encode(sigBytes);

  const { token, address: addr, expires_at, is_admin } = await postVerify({ address, signature, nonce });
  const auth = { token, address: addr, expiresAt: expires_at, isAdmin: !!is_admin };
  saveAuth(auth);
  return auth;
}
