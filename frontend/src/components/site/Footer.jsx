import { Github, Send } from "lucide-react";

function XIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="relative border-t border-white/5 mt-12" data-testid="site-footer">
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-full roulette-wheel" />
              <span className="font-display font-black text-2xl tracking-tight">$ROLLAT</span>
            </div>
            <p className="text-white/45 text-sm leading-relaxed max-w-md mb-6">
              The on-chain roulette. Hold the bag. Survive 24 hours. Win the pot.
              Powered by Chainlink VRF on Solana.
            </p>
            <div className="flex gap-3">
              <Social icon={XIcon} label="x" href="https://x.com/Rollat_online" />
              <Social icon={Send} label="telegram" href="https://t.me/rollat" />
              <Social icon={Github} label="github" href="#" />
            </div>
          </div>

          <FooterCol title="Protocol" links={[
            { label: "Mechanics", href: "#mechanics" },
            { label: "Tokenomics", href: "#tokenomics" },
            { label: "Provably Fair", href: "#vrf" },
            { label: "Hall of Fame", href: "#hall" },
          ]} />

          <FooterCol title="Resources" links={[
            { label: "Whitepaper", href: "#" },
            { label: "Audit", href: "#" },
            { label: "Contract", href: "#" },
            { label: "Brand Kit", href: "#" },
          ]} />

          <FooterCol title="Buy $ROLLAT" links={[
            { label: "Jupiter", href: "#" },
            { label: "Raydium", href: "#" },
            { label: "DexScreener", href: "#" },
            { label: "Birdeye", href: "#" },
          ]} />
        </div>

        <div className="mt-14 pt-6 border-t border-white/5 flex flex-col md:flex-row justify-between gap-4 text-xs text-white/40 font-mono uppercase tracking-widest">
          <div>© 2025 $ROLLAT · The wheel never sleeps.</div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gold">Terms</a>
            <a href="#" className="hover:text-gold">Privacy</a>
            <a href="#" className="hover:text-gold">Disclaimer</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function Social({ icon: Icon, label, href = "#" }) {
  const isExternal = href.startsWith("http");
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="w-9 h-9 border border-white/10 hover:border-gold/40 hover:text-gold flex items-center justify-center rounded-sm text-white/60 transition-colors"
      data-testid={`social-${label}`}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
    </a>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] font-mono font-bold text-gold mb-4">{title}</div>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-sm text-white/55 hover:text-white transition-colors">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
