import { motion } from "framer-motion";
import { useWinners } from "@/lib/api";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { Trophy } from "lucide-react";
import { SectionLabel } from "./HowItWorks";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} SOL`;

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function HallOfFame() {
  const winners = useWinners(12);
  const { spinState } = useSpinPhase() || {};
  const phase = spinState?.phase || "idle";
  const safeWinners = Array.isArray(winners) ? winners : [];
  const top3 = [...safeWinners].sort((a, b) => b.amount_sol - a.amount_sol).slice(0, 3);

  return (
    <section id="hall" className="relative py-24 md:py-32 px-6 md:px-12" data-testid="hall-of-fame-section">
      <div className="max-w-[1400px] mx-auto">
        <SectionLabel>Hall of Fame</SectionLabel>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-12">
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter" data-testid="hall-headline">
            Permanent. <span className="text-white/40">On-chain.</span>
          </h2>
          <p className="text-white/55 max-w-md text-sm">
            Every spin recorded forever. SOL paid out the moment the wheel stops.
          </p>
        </div>

        {/* Podium — only shows once we have real winners */}
        {safeWinners.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {top3.map((w, i) => (
              <Podium key={w.id} winner={w} place={i + 1} />
            ))}
          </div>
        )}

        {/* Empty state — pre-first-spin */}
        {safeWinners.length === 0 && phase !== "spinning" && (
          <div
            className="border border-gold/30 bg-gold/[0.03] rounded-sm p-10 md:p-14 text-center mb-10"
            data-testid="hall-empty-state"
          >
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-3">// awaiting round #1</div>
            <h3 className="font-display font-black text-2xl md:text-3xl tracking-tighter mb-3">
              Hall of Fame is <span className="text-gold">empty.</span>
            </h3>
            <p className="text-white/55 max-w-xl mx-auto text-sm md:text-base">
              No spins have resolved yet. The first winner gets crowned at the first
              spin after the 24h snapshot window completes — and from then on, every
              round is recorded here forever, on-chain.
            </p>
          </div>
        )}

        {/* Table */}
        <div className="border border-white/5 rounded-sm overflow-hidden bg-obsidian-900/40" data-testid="hall-table">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-obsidian-800/50 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45">
            <div className="col-span-1">Round</div>
            <div className="col-span-4">Wallet</div>
            <div className="col-span-2">Tickets</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-1">Odds</div>
            <div className="col-span-2 text-right">Payout</div>
          </div>

          {/* Live round row */}
          {phase === "spinning" && (
            <div className="grid grid-cols-2 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-b border-crimson/20 bg-crimson/5 text-sm">
              <div className="col-span-1 font-mono text-crimson text-xs">#{spinState?.round_number || "—"}</div>
              <div className="md:col-span-4 font-mono text-crimson/80 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-crimson animate-ping" />
                IN PROGRESS
              </div>
              <div className="md:col-span-7 font-mono text-crimson/50 text-xs">Spinning now...</div>
            </div>
          )}

          {safeWinners.map((w, i) => {
            const odds = w.participants_count > 0
              ? `1/${w.participants_count}`
              : "—";
            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="grid grid-cols-2 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-t border-white/5 hover:bg-white/[0.02] transition-colors text-sm"
                data-testid={`winner-row-${w.round_number}`}
              >
                <div className="col-span-1 font-mono text-white/40">#{w.round_number}</div>
                <div className="md:col-span-4 font-mono text-white truncate">{w.wallet}</div>
                <div className="md:col-span-2 font-mono text-white/70">{w.tickets}×</div>
                <div className="md:col-span-2 font-mono text-white/50 text-xs hidden md:block">{fmtDate(w.won_at)}</div>
                <div className="md:col-span-1 font-mono text-white/35 text-xs hidden md:block">{odds}</div>
                <div className="md:col-span-2 font-mono font-bold text-gold tabular-nums md:text-right">
                  {fmtSol(w.amount_sol)}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Podium({ winner, place }) {
  if (!winner) return null;
  const colors = {
    1: { ring: "border-gold/50", text: "text-gold", glow: "shadow-[0_0_60px_rgba(255,215,0,0.25)]", label: "BIGGEST WIN" },
    2: { ring: "border-white/30", text: "text-white", glow: "", label: "RUNNER UP" },
    3: { ring: "border-crimson/40", text: "text-crimson", glow: "", label: "BRONZE" },
  };
  const c = colors[place];
  return (
    <div className={`relative p-7 bg-obsidian-900/60 border ${c.ring} rounded-sm ${c.glow}`}>
      <div className="flex items-center justify-between mb-6">
        <span className="text-[10px] uppercase tracking-[0.25em] font-mono font-bold text-white/45">{c.label}</span>
        <span className={`font-display font-black text-3xl ${c.text}`}>0{place}</span>
      </div>
      <div className="font-mono text-xs text-white/50 mb-2">Round #{winner.round_number}</div>
      <div className="font-mono text-base text-white mb-4 truncate">{winner.wallet}</div>
      <div className={`font-display font-black text-3xl ${c.text} tabular-nums`}>
        {fmtSol(winner.amount_sol)}
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/40 font-mono">
        <Trophy className="w-3 h-3" /> Direct SOL payout
      </div>
    </div>
  );
}
