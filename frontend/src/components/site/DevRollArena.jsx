import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Sparkles, Trophy, Clock, ExternalLink, Copy } from "lucide-react";
import { useDevRoll } from "@/lib/useDevRoll";
import { useCountdown, pad } from "@/lib/useCountdown";
import { SectionLabel } from "./HowItWorks";

// Crimson is the dev-roll signature color so it doesn't read as a duplicate of
// the gold main wheel.
const ACCENT = "#FF3366";

const truncWallet = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "—");
const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

export default function DevRollArena() {
  const { roll, loading } = useDevRoll();
  const phase = roll?.phase || null;

  return (
    <section
      id="dev-roll"
      className="relative py-20 md:py-28 px-6 md:px-12 border-t border-crimson/10"
      data-testid="dev-roll-section"
    >
      <div className="max-w-[1400px] mx-auto">
        <DevSectionLabel />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter">
            Dev <span style={{ color: ACCENT }}>Roll.</span>
          </h2>
          <PhasePill phase={phase} />
        </div>

        <p className="text-white/55 max-w-2xl mb-10 text-base md:text-lg">
          Surprise rounds, off-cycle. The team can hand-pick a wallet pool, set a pot,
          schedule a UTC timestamp — when it hits, the roll runs live and one wallet
          takes the announced amount.
          <span className="text-white/35"> &nbsp;Separate from the daily wheel.</span>
        </p>

        <AnimatePresence mode="wait">
          {!roll && !loading && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState />
            </motion.div>
          )}
          {roll && phase === "scheduled" && (
            <motion.div key="scheduled" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ScheduledView roll={roll} />
            </motion.div>
          )}
          {roll && phase === "spinning" && (
            <motion.div key="spinning" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SpinningView roll={roll} />
            </motion.div>
          )}
          {roll && phase === "resolved" && (
            <motion.div key="resolved" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ResolvedView roll={roll} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DevSectionLabel() {
  // Mirrors SectionLabel from HowItWorks but in crimson so the section reads as distinct.
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-px" style={{ backgroundColor: ACCENT }} />
      <span className="text-[10px] uppercase tracking-[0.3em] font-mono font-bold" style={{ color: ACCENT }}>
        Dev Roll · Off-cycle
      </span>
    </div>
  );
}

function PhasePill({ phase }) {
  const configs = {
    null: { dot: "bg-white/30", text: "text-white/45", label: "NO ROLL SCHEDULED" },
    scheduled: { dot: "animate-pulse", text: "", label: "SCHEDULED" },
    spinning: { dot: "animate-ping", text: "", label: "SPINNING · LIVE" },
    resolved: { dot: "", text: "", label: "WINNER ANNOUNCED" },
  };
  const key = phase ?? "null";
  const c = configs[key] || configs.null;
  const accent = phase ? ACCENT : undefined;
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-[11px] uppercase tracking-[0.2em] ${c.text}`}
      style={{
        borderColor: accent ? `${ACCENT}55` : "#ffffff20",
        color: accent || undefined,
      }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} style={{ backgroundColor: accent || undefined }} />
      {c.label}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-sm p-8 md:p-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6" data-testid="dev-roll-empty">
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-sm flex items-center justify-center border"
          style={{ borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}10` }}
        >
          <Gift className="w-6 h-6" style={{ color: ACCENT }} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
            Awaiting next dev roll
          </div>
          <div className="font-display font-bold text-xl text-white">
            No dev roll scheduled right now.
          </div>
        </div>
      </div>
      <div className="text-sm text-white/45 font-mono uppercase tracking-widest">
        Watch this space.
      </div>
    </div>
  );
}

function ScheduledView({ roll }) {
  const t = useCountdown(roll.scheduled_at);
  const wallets = roll.wallets || [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass rounded-sm p-7 md:p-10 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: `${ACCENT}10` }} />
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-4" style={{ color: ACCENT }}>
          Spins In
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 font-mono mb-6">
          {[
            { label: "DAYS", v: t.d },
            { label: "HRS", v: t.h },
            { label: "MIN", v: t.m },
            { label: "SEC", v: t.s },
          ].map((c, i) => (
            <div key={c.label} className="flex items-end gap-3">
              <div>
                <div className="text-[9px] tracking-[0.25em] text-white/40 mb-0.5">{c.label}</div>
                <div className="text-4xl md:text-5xl font-black tabular-nums" style={{ color: ACCENT }}>
                  {pad(c.v)}
                </div>
              </div>
              {i < 3 && <span className="text-3xl text-white/20 pb-1">:</span>}
            </div>
          ))}
        </div>
        <div className="text-xs text-white/45 font-mono uppercase tracking-widest">
          Scheduled · {new Date(roll.scheduled_at).toUTCString()}
        </div>
      </div>

      <div className="glass rounded-sm p-7 md:p-8 flex flex-col justify-between" data-testid="dev-roll-pot">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
            Announced Pot
          </div>
          <div className="font-mono font-black text-4xl md:text-5xl tabular-nums tracking-tight" style={{ color: ACCENT }}>
            {fmtSol(roll.pot_sol)}
          </div>
          <div className="text-xs text-white/45 mt-2 font-mono">
            {wallets.length} wallet{wallets.length === 1 ? "" : "s"} in the pool · 1 ticket each
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono text-white/35">
          <Sparkles className="w-3 h-3" />
          Equal odds · uniform random
        </div>
      </div>

      <div className="lg:col-span-3 glass rounded-sm p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-3">
          Wallet Pool · {wallets.length}
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-hidden pb-2">
          {wallets.map((w) => (
            <div
              key={w}
              className="shrink-0 px-3 py-2 rounded-sm border bg-obsidian-900/60 font-mono text-xs text-white/70"
              style={{ borderColor: "#ffffff10" }}
              data-testid={`dev-pool-${w.slice(0, 8)}`}
            >
              {truncWallet(w)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpinningView({ roll }) {
  const wallets = useMemo(() => roll.wallets || [], [roll.wallets]);
  const [idx, setIdx] = useState(0);

  // Slot-machine tick: starts fast, slows down on a curve. This reads visually
  // distinct from the main wheel's smooth horizontal reel.
  useEffect(() => {
    if (wallets.length === 0) return;
    let cancelled = false;
    let i = 0;
    const start = performance.now();
    const total = 9000; // matches DEV_SPIN_ANIMATION_SECS
    const step = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / total, 1);
      // ease-out: short delays early, long delays at the end.
      const delay = 40 + Math.pow(progress, 2.6) * 480;
      i = Math.floor(Math.random() * wallets.length);
      setIdx(i);
      if (progress < 1) setTimeout(step, delay);
    };
    step();
    return () => { cancelled = true; };
  }, [wallets.length]);

  const visible = useMemo(() => {
    if (wallets.length === 0) return [];
    const span = 5;
    const out = [];
    for (let off = -2; off <= 2; off++) {
      const j = ((idx + off) % wallets.length + wallets.length) % wallets.length;
      out.push({ off, wallet: wallets[j] });
    }
    return out;
  }, [idx, wallets]);

  return (
    <div className="glass rounded-sm p-7 md:p-12 relative overflow-hidden" data-testid="dev-roll-spinning">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)`,
        }}
      />
      <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-6 text-center" style={{ color: ACCENT }}>
        Spinning · Pot {fmtSol(roll.pot_sol)}
      </div>

      {/* Vertical slot reel — distinctly different from the horizontal main wheel */}
      <div className="relative h-[320px] md:h-[380px] flex flex-col items-center justify-center gap-2 select-none">
        {visible.map(({ off, wallet }) => {
          const isCenter = off === 0;
          const opacity = 1 - Math.abs(off) * 0.28;
          const scale = isCenter ? 1.0 : 0.85 - Math.abs(off) * 0.05;
          return (
            <motion.div
              key={`${off}-${wallet}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity, y: 0, scale }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={`px-6 py-4 rounded-sm border font-mono text-base md:text-lg ${isCenter ? "bg-obsidian-900/80" : "bg-obsidian-900/30"}`}
              style={{
                borderColor: isCenter ? ACCENT : "#ffffff10",
                color: isCenter ? "#fff" : "#ffffff80",
                boxShadow: isCenter ? `0 0 32px ${ACCENT}40` : "none",
                minWidth: 280,
                textAlign: "center",
                fontWeight: isCenter ? 700 : 400,
              }}
            >
              {truncWallet(wallet)}
            </motion.div>
          );
        })}

        {/* Center selector lines */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-[34px] flex items-center justify-between px-4 pointer-events-none">
          <div className="w-3 h-3 rotate-45" style={{ backgroundColor: ACCENT }} />
          <div className="w-3 h-3 rotate-45" style={{ backgroundColor: ACCENT }} />
        </div>
      </div>

      <div className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] font-mono text-white/40">
        {wallets.length} wallets · uniform random · winner locks in shortly
      </div>
    </div>
  );
}

function ResolvedView({ roll }) {
  const winner = roll.winner;
  const explorer = winner ? `https://solscan.io/account/${winner}` : "#";
  return (
    <div
      className="glass rounded-sm p-8 md:p-12 relative overflow-hidden"
      style={{ borderColor: `${ACCENT}40` }}
      data-testid="dev-roll-winner"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(70% 60% at 50% 0%, ${ACCENT}24 0%, transparent 60%)`,
        }}
      />
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
            <Trophy className="w-3 h-3 inline -mt-0.5 mr-1.5" />
            Dev Roll Winner
          </div>
          <div
            className="font-mono font-black text-2xl md:text-4xl break-all leading-tight"
            data-testid="dev-roll-winner-wallet"
          >
            {winner}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => navigator.clipboard?.writeText(winner || "")}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45 hover:text-white"
            >
              <Copy className="w-3 h-3" /> copy
            </button>
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45 hover:text-white"
            >
              <ExternalLink className="w-3 h-3" /> solscan
            </a>
          </div>
        </div>
        <div className="md:text-right">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-2">Pot</div>
          <div className="font-mono font-black text-5xl md:text-6xl tabular-nums" style={{ color: ACCENT }}>
            {fmtSol(roll.pot_sol)}
          </div>
          <div className="text-xs text-white/40 mt-2 font-mono flex items-center gap-1.5 md:justify-end">
            <Clock className="w-3 h-3" />
            {roll.resolved_at ? new Date(roll.resolved_at).toUTCString() : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
