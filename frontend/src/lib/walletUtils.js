import { PublicKey } from "@solana/web3.js";

export function isValidSolanaAddress(addr) {
  if (typeof addr !== "string") return false;
  const trimmed = addr.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function truncWallet(addr, head = 4, tail = 4) {
  if (!addr || typeof addr !== "string") return "—";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
