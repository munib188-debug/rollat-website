import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wallet, Menu, X } from "lucide-react";
import { toast } from "sonner";

export default function Header() {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const loc = useLocation();

  const handleConnect = () => {
    setConnected(true);
    toast.success("Phantom connected (mock)", {
      description: "5xq2...c8nP — qualified for Round #100",
    });
  };

  const links = [
    { href: "/#roulette-arena", label: "Live Spin" },
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
          <div className="w-8 h-8 rounded-full roulette-wheel" />
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
          <Button
            onClick={handleConnect}
            className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-9 px-4"
            data-testid="header-connect-wallet-btn"
          >
            <Wallet className="w-4 h-4 mr-2" />
            {connected ? "5xq2…c8nP" : "Connect"}
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
          <Button
            onClick={handleConnect}
            className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm"
            data-testid="mobile-connect-wallet-btn"
          >
            <Wallet className="w-4 h-4 mr-2" />
            {connected ? "Connected" : "Connect Phantom"}
          </Button>
        </div>
      )}
    </header>
  );
}
