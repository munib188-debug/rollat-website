import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { X, ExternalLink } from "lucide-react";

const INSTALL_LINKS = [
  { name: "Phantom",  url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/downloads" },
];

export default function WalletPicker({ open, onClose }) {
  const { wallets, select, connect } = useWallet();

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const detected = wallets.filter(
    (w) => w.readyState === "Installed" || w.readyState === "Loadable"
  );

  const pick = async (walletName) => {
    try {
      select(walletName);
      // Defer one tick so the WalletProvider commits the selection
      // before we ask the adapter to connect — without this, connect()
      // can fire before `wallet` is set and the popup never appears.
      setTimeout(() => {
        connect().catch((err) => {
          // Surface any connection error in the console for diagnostics.
          // Common ones: user rejected, wallet locked, popup blocked.
          // eslint-disable-next-line no-console
          console.error("[wallet] connect failed:", err);
        });
      }, 0);
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[wallet] select failed:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      data-testid="wallet-picker-overlay"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-obsidian-900 border border-white/10 rounded-sm shadow-[0_0_60px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-gold mb-1">$ROLLAT</div>
            <div className="font-display font-black text-xl text-white">Connect a wallet</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-2 text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {detected.length === 0 ? (
            <NoWalletsView />
          ) : (
            <ul className="space-y-2">
              {detected.map((w) => (
                <li key={w.adapter.name}>
                  <button
                    onClick={() => pick(w.adapter.name)}
                    className="w-full flex items-center gap-4 p-3 rounded-sm border border-white/5 hover:border-gold/40 hover:bg-white/[0.03] transition-colors group"
                    data-testid={`wallet-${w.adapter.name.toLowerCase()}`}
                  >
                    {w.adapter.icon ? (
                      <img src={w.adapter.icon} alt="" className="w-9 h-9 rounded-sm" />
                    ) : (
                      <div className="w-9 h-9 rounded-sm bg-white/5" />
                    )}
                    <div className="flex-1 text-left">
                      <div className="font-bold text-white">{w.adapter.name}</div>
                      <div className="text-xs text-white/40 font-mono uppercase tracking-widest">
                        {w.readyState === "Installed" ? "Detected" : "Available"}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest font-mono text-white/30 group-hover:text-gold">
                      Connect →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 text-[10px] font-mono uppercase tracking-widest text-white/35">
          By connecting, you agree this site can read your address. No transactions will be requested without a separate prompt.
        </div>
      </div>
    </div>
  );
}

function NoWalletsView() {
  return (
    <div>
      <div className="text-sm text-white/65 mb-4">
        No Solana wallet detected in this browser. Install one of these and reload the page:
      </div>
      <ul className="space-y-2">
        {INSTALL_LINKS.map((w) => (
          <li key={w.name}>
            <a
              href={w.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-sm border border-white/5 hover:border-gold/40 hover:bg-white/[0.03] transition-colors"
            >
              <span className="font-bold text-white">{w.name}</span>
              <ExternalLink className="w-4 h-4 text-white/40" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
