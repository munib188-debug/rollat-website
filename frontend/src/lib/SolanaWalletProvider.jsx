import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

// Modern Phantom, Solflare, Backpack, Glow, etc. all implement the Wallet
// Standard (https://github.com/wallet-standard/wallet-standard). The empty
// `wallets` array tells the provider to auto-detect anything injected by the
// browser via that standard. Avoid passing explicit adapters here — it can
// register the same wallet twice and cause "modal opens but click does
// nothing" UX.
export default function SolanaWalletProvider({ children }) {
  const endpoint = useMemo(
    () => process.env.REACT_APP_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"),
    []
  );

  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
