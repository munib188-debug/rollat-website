import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { SolanaMobileWalletAdapter, createDefaultAuthorizationResultCache, createDefaultAddressSelector } from "@solana-mobile/wallet-adapter-mobile";

import "@solana/wallet-adapter-react-ui/styles.css";

// Modern Phantom, Solflare, Backpack, Glow, etc. all implement the Wallet
// Standard (https://github.com/wallet-standard/wallet-standard). The empty
// `wallets` array tells the provider to auto-detect anything injected by the
// browser via that standard. Avoid passing explicit adapters here — it can
// register the same wallet twice and cause "modal opens but click does
// nothing" UX.
// SolanaMobileWalletAdapter is added explicitly so mobile browser users can
// connect via deep link to any MWA-compatible wallet (Phantom, Backpack, etc.)
export default function SolanaWalletProvider({ children }) {
  const endpoint = useMemo(
    () => process.env.REACT_APP_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"),
    []
  );

  const wallets = useMemo(() => [
    new SolanaMobileWalletAdapter({
      addressSelector: createDefaultAddressSelector(),
      appIdentity: { name: "Rollat", uri: "https://rollat.vercel.app", icon: "/logo192.png" },
      authorizationResultCache: createDefaultAuthorizationResultCache(),
      cluster: "mainnet-beta",
    }),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
