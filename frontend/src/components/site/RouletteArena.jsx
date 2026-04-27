import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimate } from "framer-motion";
import { Zap, Trophy, ExternalLink } from "lucide-react";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { useCountdown, pad } from "@/lib/useCountdown";
import { launchConfetti } from "@/lib/confetti";
import { SectionLabel } from "./HowItWorks";

const TICKET_COLORS = {
  1: "#ffffff80",
  2: "#ffffff",
  3: "#00FFA3",
  4: "#9945FF",
  5: "#FF3366",
  6: "#FFD700",
};

const truncWallet = (w) =>
  w ? `${w.slice(0, 6)}...${w.slice(-4)}` : "—";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

export default function RouletteArena() {
  const { spinState, stats } = useSpinPhase() || {};
  const phase = spinState?.phase || "idle";
  const t = useCountdown(stats?.next_spin_at);

  return (
    <section id="roulette-arena" className="relative py-24 md:py-32 px-6 md:px-12 grain felt-bg" data-testid="roulette-arena-section">
      <div className="max-w-[1400px] mx-auto">
        <SectionLabel>Live Roulette</SectionLabel>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-12">
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter">
            Watch it <span className="gold-text">Spin.</span>
          </h2>
          <PhaseIndicator phase={phase} />
        </div>

        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <IdleDisplay t={t} stats={stats} />
            </motion.div>
          )}
          {phase === "spinning" && (
            <motion.div key="spinning" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SpinningAnimation participants={spinState?.participants || []} />
            </motion.div>
          )}
          {phase === "resolved" && (
            <motion.div key="resolved" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <WinnerReveal winner={spinState?.winner} stats={stats} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pot meter — always visible */}
        <PotMeter current={stats?.current_pot_sol} threshold={stats?.pot_threshold_sol} />
      </div>
    </section>
  );
}

function PhaseIndicator({ phase }) {
  const configs = {
    idle: { dot: "bg-emerald_neon", text: "text-emerald_neon", label: "IDLE · AWAITING SPIN" },
    spinning: { dot: "bg-crimson animate-ping", text: "text-crimson", label: "SPINNING · LIVE NOW" },
    resolved: { dot: "bg-gold", text: "text-gold", label: "WINNER ANNOUNCED" },
  };
  const c = configs[phase] || configs.idle;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-white/10 font-mono text-[11px] uppercase tracking-[0.2em] ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </div>
  );
}

function IdleDisplay({ t, stats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* Left: countdown + info */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-4">
          Next Spin In
        </div>
        <div className="flex items-end gap-3 font-mono mb-8">
          {[
            { label: "HRS", v: t.h },
            { label: "MIN", v: t.m },
            { label: "SEC", v: t.s },
          ].map((c, i) => (
            <div key={c.label} className="flex items-end gap-3">
              <div className="text-center">
                <div className="text-[10px] tracking-[0.25em] text-white/35 mb-1">{c.label}</div>
                <div className="text-5xl sm:text-6xl font-black gold-text tabular-nums">{pad(c.v)}</div>
              </div>
              {i < 2 && <span className="text-4xl text-white/20 pb-1">:</span>}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm text-white/50">
          <div><span className="text-white">{stats?.total_qualified_wallets ?? "—"}</span> wallets qualified</div>
          <div>Round <span className="text-white">#{stats?.spins_completed ? stats.spins_completed + 1 : "—"}</span></div>
          <div>Pot <span className="text-gold">{stats?.current_pot_sol ? `${stats.current_pot_sol} SOL` : "—"}</span></div>
        </div>
      </div>

      {/* Right: decorative idle wheel */}
      <div className="flex justify-center lg:justify-end">
        <div className="relative w-64 h-64 sm:w-80 sm:h-80">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gold/20 via-crimson/10 to-emerald_neon/5 blur-2xl opacity-50" />
          <motion.div
            className="absolute inset-4 rounded-full roulette-wheel shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
            animate={{ rotate: 360 }}
            transition={{ duration: 18, ease: "linear", repeat: Infinity }}
          />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
            <div className="w-0 h-0" style={{
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: "16px solid #FFD700",
              filter: "drop-shadow(0 0 6px rgba(255,215,0,0.8))",
            }} />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-gold/80 mb-1">STANDBY</div>
              <div className="font-display font-black text-xl text-white">$ROLLAT</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpinningAnimation({ participants }) {
  const [scope, animate] = useAnimate();
  const stripRef = useRef(null);
  const hasAnimated = useRef(false);

  // Build the reel strip: shuffle participants, repeat 3×, we scroll through it
  const reelItems = [...participants, ...participants, ...participants].sort(() => Math.random() - 0.5);
  const CARD_WIDTH = 160; // px
  const CARD_GAP = 8;
  const STEP = CARD_WIDTH + CARD_GAP;
  const totalWidth = reelItems.length * STEP;

  useEffect(() => {
    if (hasAnimated.current || !stripRef.current) return;
    hasAnimated.current = true;

    const targetX = -(totalWidth * 0.65);

    animate(stripRef.current, {
      x: [0, -(totalWidth * 0.1), -(totalWidth * 0.55), targetX],
    }, {
      duration: 9,
      times: [0, 0.12, 0.6, 1],
      ease: ["easeIn", "linear", [0.15, 0.85, 0.25, 1.0]],
    });
  }, [animate, totalWidth]);

  return (
    <div className="relative" ref={scope}>
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 text-crimson font-mono text-lg font-bold animate-pulse uppercase tracking-widest">
          <Zap className="w-5 h-5" />
          Selecting Winner
          <Zap className="w-5 h-5" />
        </div>
      </div>

      {/* Reel viewport */}
      <div className="relative overflow-hidden rounded-sm border border-white/10 bg-obsidian-950/80">
        {/* Center pointer lines */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[162px] border-x-2 border-gold/60 z-10 pointer-events-none rounded-sm"
          style={{ boxShadow: "0 0 20px rgba(255,215,0,0.3), inset 0 0 20px rgba(255,215,0,0.05)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-obsidian-950 via-transparent to-obsidian-950 z-20 pointer-events-none" />

        {/* Scrolling strip */}
        <div className="py-6 pl-[calc(50vw-80px)] md:pl-[calc(50%-80px)]">
          <motion.div ref={stripRef} className="flex gap-2" style={{ width: totalWidth }}>
            {reelItems.map((p, i) => (
              <div
                key={i}
                className="shrink-0 w-[160px] px-3 py-4 rounded-sm border border-white/10 bg-obsidian-900/80 text-center"
              >
                <div
                  className="text-[11px] font-mono font-bold mb-2 uppercase tracking-wider"
                  style={{ color: TICKET_COLORS[p.tickets] || "#fff" }}
                >
                  {p.tickets}× TICKET{p.tickets > 1 ? "S" : ""}
                </div>
                <div className="font-mono text-xs text-white/70 truncate">
                  {truncWallet(p.wallet)}
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      <div className="text-center mt-4 font-mono text-xs text-white/30 uppercase tracking-widest">
        {participants.length} participants · Weighted by tickets
      </div>
    </div>
  );
}

function WinnerReveal({ winner, stats }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cleanup = launchConfetti(canvasRef.current, 4500);
    return cleanup;
  }, []);

  if (!winner) return null;

  const shareText = `I just witnessed ${fmtSol(winner.amount_sol)} awarded in @ROLLATcoin's on-chain roulette 🎰 Round #${winner.round_number} · $ROLLAT`;

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />

      <div className="flex flex-col items-center py-8">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 15 }}
          className="relative w-full max-w-lg p-8 md:p-12 rounded-sm border border-gold/40 bg-obsidian-900/80 text-center shadow-[0_0_80px_rgba(255,215,0,0.2)]"
          data-testid="winner-reveal"
        >
          <div className="absolute inset-0 rounded-sm opacity-30"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.3), transparent 70%)" }}
          />

          <div className="relative">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-gold/20 border-2 border-gold/50 flex items-center justify-center shadow-[0_0_40px_rgba(255,215,0,0.4)]">
                <Trophy className="w-8 h-8 text-gold" />
              </div>
            </div>

            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/50 mb-2">
              Round #{winner.round_number} · Winner
            </div>

            <div className="font-mono text-lg text-white/80 mb-6 break-all">
              {winner.wallet}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="font-display font-black text-5xl md:text-6xl gold-text tabular-nums mb-3"
            >
              {fmtSol(winner.amount_sol)}
            </motion.div>

            <div className="font-mono text-sm text-white/40 mb-8">
              {winner.tickets}× tickets · {stats?.total_qualified_wallets ? `1 of ${stats.total_qualified_wallets} qualified wallets` : ""}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm bg-gold text-obsidian-950 font-bold text-xs uppercase tracking-widest hover:bg-gold-hover transition-colors"
              >
                Share on X
              </a>
              <a
                href="#hall"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm border border-white/20 text-white/70 hover:text-white hover:border-white/40 font-mono text-xs uppercase tracking-widest transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Hall of Fame
              </a>
            </div>
          </div>
        </motion.div>

        <p className="mt-6 font-mono text-xs text-white/25 uppercase tracking-widest">
          Next round begins in ~30 seconds
        </p>
      </div>
    </>
  );
}

function PotMeter({ current, threshold }) {
  if (!current || !threshold) return null;
  const pct = Math.min(100, (current / threshold) * 100);
  const ready = current >= threshold;

  return (
    <div className="mt-12 p-5 border border-white/5 rounded-sm bg-obsidian-900/40">
      <div className="flex items-center justify-between mb-3 font-mono text-xs uppercase tracking-widest text-white/40">
        <span>Pot Meter</span>
        <span className={ready ? "text-emerald_neon" : "text-white/40"}>
          {ready ? "✓ Threshold Met" : `${pct.toFixed(0)}% to threshold`}
        </span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className={`h-full rounded-full ${ready ? "bg-emerald_neon" : "bg-gold"}`}
        />
      </div>
      <div className="flex items-center justify-between mt-2 font-mono text-xs text-white/35">
        <span>{current?.toLocaleString("en-US", { maximumFractionDigits: 1 })} SOL current</span>
        <span>{threshold} SOL min</span>
      </div>
    </div>
  );
}
