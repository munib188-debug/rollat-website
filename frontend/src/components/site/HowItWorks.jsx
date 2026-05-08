import { motion } from "framer-motion";
import { Wallet, Clock, Dice5, Zap } from "lucide-react";

const steps = [
  {
    n: "01",
    title: "Hold 1M+",
    desc: "Buy and hold at least 1,000,000 $ROLLAT in any Solana wallet. That's your buy-in. No staking contract, no lockup.",
    icon: Wallet,
    accent: "gold",
  },
  {
    n: "02",
    title: "Survive 24 Snapshots",
    desc: "Every hour the contract takes a snapshot. Wallets present in all 24 consecutive snapshots qualify for the spin.",
    icon: Clock,
    accent: "crimson",
  },
  {
    n: "03",
    title: "VRF Spins",
    desc: "Switchboard VRF picks one wallet on-chain. Tickets scale with your bag — bigger holders get more shots, capped at 6.",
    icon: Dice5,
    accent: "emerald",
  },
  {
    n: "04",
    title: "Direct SOL Drop",
    desc: "The pot drops straight into the winner's connected wallet as SOL. No claim portal. No NFT trinket. Just instant payout.",
    icon: Zap,
    accent: "gold",
  },
];

export default function HowItWorks() {
  return (
    <section id="mechanics" className="relative py-24 md:py-32 px-6 md:px-12" data-testid="how-it-works-section">
      <div className="max-w-[1400px] mx-auto">
        <SectionLabel>The Mechanics</SectionLabel>
        <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter mb-3" data-testid="how-headline">
          Four steps. <span className="text-white/40">Zero friction.</span>
        </h2>
        <p className="text-white/55 max-w-2xl mb-16 text-base md:text-lg">
          The contract handles qualification, the spin, and the payout. No claim portal hostage,
          no team key, no manual approvals.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const accentMap = {
              gold: "text-gold border-gold/30",
              crimson: "text-crimson border-crimson/30",
              emerald: "text-emerald_neon border-emerald_neon/30",
            };
            return (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="group relative p-7 bg-obsidian-900/60 border border-white/5 hover:border-white/15 transition-colors rounded-sm"
                data-testid={`step-${s.n}`}
              >
                <div className="flex items-center justify-between mb-8">
                  <span className="font-mono text-[10px] tracking-[0.25em] text-white/30">STEP / {s.n}</span>
                  <Icon className={`w-5 h-5 ${accentMap[s.accent].split(" ")[0]}`} />
                </div>
                <h3 className="font-display font-bold text-2xl mb-3 leading-tight">{s.title}</h3>
                <p className="text-white/55 text-sm leading-relaxed">{s.desc}</p>
                <div className={`absolute bottom-0 left-0 h-px w-0 group-hover:w-full transition-all duration-500 ${
                  s.accent === "gold" ? "bg-gold" : s.accent === "crimson" ? "bg-crimson" : "bg-emerald_neon"
                }`} />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-px bg-gold" />
      <span className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold font-bold">
        {children}
      </span>
    </div>
  );
}
