import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wallet, Menu, X, LogOut, ShieldCheck, Pen } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { truncWallet } from "@/lib/walletUtils";
import { useAuth } from "@/lib/AuthContext";
import WalletPicker from "./WalletPicker";

export default function Header() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { publicKey, wallet, disconnect, connecting } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { isAuthenticated, isAdmin, signIn, signOut, signingIn } = useAuth();

  const connected = !!publicKey;
  const addr = publicKey?.toBase58();
  const showSignIn = connected && !isAuthenticated;

  const handleSignIn = async () => {
    try {
      await signIn();
      toast.success("Signed in", {
        description: "Wallet ownership verified. Token expires in 1h.",
      });
    } catch (e) {
      toast.error("Sign-in failed", { description: e?.message || "Please try again." });
    }
  };

  const handleConnect = () => {
    if (connected) {
      // Already connected: disconnect (also clears the JWT via AuthContext effect)
      disconnect()
        .then(() => {
          signOut();
          toast.success("Wallet disconnected");
        })
        .catch((e) => toast.error("Disconnect failed", { description: e?.message }));
    } else {
      // Open our custom wallet picker (lists wallets detected via Wallet Standard)
      setPickerOpen(true);
    }
  };

  const links = [
    { href: "/#roulette-arena", label: "Live Spin" },
    { href: "/#dev-roll", label: "Dev Roll" },
    { href: "/#mechanics", label: "Mechanics" },
    { href: "/#qualified", label: "Qualified" },
    { href: "/#tokenomics", label: "Tokenomics" },
    { href: "/#hall", label: "Hall of Fame" },
    { href: "/#faq", label: "FAQ" },
  ];

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 glass border-b border-white/5"
      data-testid="site-header"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group" data-testid="logo-link">
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
          {showSignIn && (
            <Button
              onClick={handleSignIn}
              disabled={signingIn}
              variant="outline"
              className="border-gold/50 text-gold hover:bg-gold/10 hover:text-gold font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-3"
              data-testid="header-sign-in-btn"
              title="Sign a message to prove wallet ownership (no transaction)"
            >
              <Pen className="w-3.5 h-3.5 mr-1.5" />
              {signingIn ? "Signing…" : "Sign in"}
            </Button>
          )}
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-4"
            data-testid="header-connect-wallet-btn"
            title={connected ? `${wallet?.adapter?.name} · click to disconnect` : "Connect a Solana wallet"}
          >
            {connected ? (
              <>
                {isAuthenticated ? (
                  <ShieldCheck className="w-4 h-4 mr-2 text-emerald-300" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                {truncWallet(addr)}
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                {connecting ? "Connecting…" : "Connect"}
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
          {showSignIn && (
            <Button
              onClick={() => { handleSignIn(); setOpen(false); }}
              disabled={signingIn}
              variant="outline"
              className="border-gold/50 text-gold hover:bg-gold/10 hover:text-gold font-bold uppercase tracking-widest text-xs rounded-sm"
              data-testid="mobile-sign-in-btn"
            >
              <Pen className="w-3.5 h-3.5 mr-2" />
              {signingIn ? "Signing…" : "Sign in"}
            </Button>
          )}
          <Button
            onClick={() => { handleConnect(); setOpen(false); }}
            disabled={connecting}
            className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm"
            data-testid="mobile-connect-wallet-btn"
          >
            {connected ? (
              <>
                {isAuthenticated ? (
                  <ShieldCheck className="w-4 h-4 mr-2 text-emerald-300" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                Disconnect ({truncWallet(addr)})
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                {connecting ? "Connecting…" : "Connect Wallet"}
              </>
            )}
          </Button>
        </div>
      )}

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </header>
  );
}
