import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wallet, Menu, X, LogOut, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { truncWallet } from "@/lib/walletUtils";
import { useAuth } from "@/lib/AuthContext";
import WalletPicker from "./WalletPicker";

export default function Header() {
  const [open, setOpen] = useState(false);
  const [hoveringDisconnect, setHoveringDisconnect] = useState(false);
  const { publicKey, wallet, disconnect, connecting } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { isAuthenticated, isAdmin, signOut, signingIn } = useAuth();

  const connected = !!publicKey;
  const addr = publicKey?.toBase58();

  const handleConnect = () => {
    if (connected) {
      disconnect()
        .then(() => {
          signOut();
          toast.success("Wallet disconnected");
        })
        .catch((e) => toast.error("Disconnect failed", { description: e?.message }));
    } else {
      setPickerOpen(true);
    }
  };

  const links = [
    { href: "/#mechanics", label: "Mechanics" },
    { href: "/#roulette-arena", label: "Live Spin" },
    { href: "/#dev-roll", label: "Dev Roll" },
    { href: "/#qualified", label: "Qualified" },
    { href: "/#tokenomics", label: "Tokenomics" },
    { href: "/#hall", label: "Hall of Fame" },
    { href: "/#faq", label: "FAQ" },
  ];

  // Derived connect button state
  const isConnecting = connecting || (connected && signingIn && !isAuthenticated);

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 glass border-b border-white/5"
      data-testid="site-header"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        <Link
          to="/"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2.5 group"
          data-testid="logo-link"
        >
          <img src="/logo.svg" alt="" className="w-8 h-8 transition-transform duration-700 group-hover:rotate-180" />
          <span className="font-display font-black text-xl tracking-tight">
            $ROLLAT
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-white/65 hover:text-gold transition-colors font-medium"
              data-testid={`nav-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/dashboard">
            <Button
              variant="ghost"
              className="text-white/70 hover:text-white hover:bg-white/5 rounded-sm"
              data-testid="header-dashboard-btn"
            >
              Dashboard
            </Button>
          </Link>
          {isAdmin && (
            <Link to="/dev">
              <Button
                variant="outline"
                className="border-crimson/40 text-crimson hover:bg-crimson/10 hover:text-crimson font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-3"
                data-testid="header-dev-btn"
                title="Dev Roll admin (admin wallet only)"
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                Dev
              </Button>
            </Link>
          )}
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            onMouseEnter={() => connected && setHoveringDisconnect(true)}
            onMouseLeave={() => setHoveringDisconnect(false)}
            className={`font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-4 transition-colors ${
              connected && hoveringDisconnect
                ? "bg-crimson/80 hover:bg-crimson text-white"
                : "bg-gold text-obsidian-950 hover:bg-gold-hover"
            }`}
            data-testid="header-connect-wallet-btn"
            title={connected ? `${wallet?.adapter?.name} · click to disconnect` : "Connect a Solana wallet"}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {signingIn ? "Signing…" : "Connecting…"}
              </>
            ) : connected ? (
              <>
                {hoveringDisconnect ? (
                  <LogOut className="w-4 h-4 mr-2" />
                ) : isAuthenticated ? (
                  <ShieldCheck className="w-4 h-4 mr-2 text-emerald-300" />
                ) : (
                  <Wallet className="w-4 h-4 mr-2" />
                )}
                {hoveringDisconnect ? "Disconnect" : truncWallet(addr)}
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                Connect
              </>
            )}
          </Button>
        </div>

        <button
          className="md:hidden text-white"
          onClick={() => setOpen(!open)}
          data-testid="mobile-menu-toggle"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-white/5 bg-obsidian-950/95 backdrop-blur-xl px-6 py-6 flex flex-col gap-4">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-gold"
              data-testid={`mobile-nav-${l.label.toLowerCase()}`}
            >
              {l.label}
            </a>
          ))}
          <Link to="/dashboard" onClick={() => setOpen(false)} className="text-white/70">Dashboard</Link>
          {isAdmin && (
            <Link to="/dev" onClick={() => setOpen(false)} className="text-crimson font-bold">Dev Roll · Admin</Link>
          )}
          <Button
            onClick={() => { handleConnect(); setOpen(false); }}
            disabled={isConnecting}
            className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-11"
            data-testid="mobile-connect-wallet-btn"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {signingIn ? "Signing…" : "Connecting…"}
              </>
            ) : connected ? (
              <>
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect ({truncWallet(addr)})
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                Connect Wallet
              </>
            )}
          </Button>
        </div>
      )}

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </header>
  );
}
