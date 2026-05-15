import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Copy, Check, Trophy, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { useWinners } from "@/lib/api";
import { useCountdown } from "@/lib/useCountdown";
import { formatPrize, formatAmount } from "@/lib/formatPrize";
import { launchConfetti } from "@/lib/confetti";
import { ROLLAT_MINT, ROLLAT_LINKS, truncateMint } from "@/lib/constants";

const IDLE_HEADLINES = [
  ["HOLD THE BAG.", "SPIN THE POT."],
  ["ONE WALLET.", "ONE WHEEL. EVERY 24H."],
  ["VRF-PICKED.", "AUTO-PAID."],
  ["NO TEAM VOTES.", "JUST CODE."],
];

const truncWallet = (w) =>
  w ? `${w.slice(0, 6)}···${w.slice(-4)}` : "—";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SOL`;

const fmtCountdown = (t) => {
  if (!t || t.firing) return "Starting…";
  const { d, h, m, s } = t;
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
};

// ─── MARQUEE ─────────────────────────────────────────────────────────────────
function Marquee({ stats, spinState, lastWinner, currency }) {
  const phase = spinState?.phase || "idle";
  const t = useCountdown(stats?.next_spin_at);

  const potValue = currency === "ROLLAT"
    ? `${(stats?.pot_rollat ?? 0).toLocaleString()} $ROLLAT`
    : fmtSol(stats?.current_pot_sol);

  const items = [];
  if (phase === "spinning") {
    items.push({ key: "live", text: "🔴 SPINNING NOW · LIVE" });
  } else if (phase === "resolved" && spinState?.winner) {
    items.push({ key: "live", text: `🏆 WINNER · ${truncWallet(spinState.winner.wallet)} WON ${formatPrize(spinState.winner)}` });
  } else {
    items.push({ key: "live", text: `🟢 LIVE · ROUND #${stats?.spins_completed ? stats.spins_completed + 1 : "—"}` });
  }
  items.push(
    { key: "next", text: `NEXT SPIN ${t.firing ? "STARTING…" : `${String(t.h).padStart(2, "0")}H ${String(t.m).padStart(2, "0")}M`}` },
    { key: "pot", text: `POT ${potValue}` },
    { key: "qualified", text: `${stats?.total_qualified_wallets ?? "—"} WALLETS QUALIFIED` },
  );
  if (lastWinner) {
    items.push({ key: "last", text: `LAST WINNER ${truncWallet(lastWinner.wallet)} · ${formatPrize(lastWinner)} · ROUND #${lastWinner.round_number}` });
  }
  items.push(
    { key: "biggest", text: `BIGGEST WIN ${fmtSol(stats?.biggest_win_sol)}` },
    { key: "distributed", text: `DISTRIBUTED ${fmtSol(stats?.total_distributed_sol)}` },
    { key: "ca", text: `CA ${truncateMint()}` },
  );

  // Render twice for seamless loop (Tailwind marquee keyframe translates 0 → -50%)
  const renderRow = (rowKey) => (
    <div className="flex shrink-0 items-center gap-6 pr-6" key={rowKey} aria-hidden={rowKey !== "a"}>
      {items.map((it, i) => (
        <div key={`${rowKey}-${it.key}`} className="flex items-center gap-6 shrink-0">
          <span className={`text-[11px] sm:text-xs font-mono uppercase tracking-[0.25em] whitespace-nowrap ${
            it.key === "live" && phase === "spinning" ? "text-crimson font-bold" :
            it.key === "live" && phase === "resolved" ? "text-gold font-bold" :
            it.key === "live" ? "text-emerald_neon" :
            "text-white/60"
          }`}>
            {it.text}
          </span>
          {i < items.length - 1 && <span className="text-gold/40">·</span>}
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="relative overflow-hidden border-y border-gold/15 bg-obsidian-900/40 py-2.5"
      data-testid="hero-marquee"
    >
      <div className="flex w-max animate-marquee">
        {renderRow("a")}
        {renderRow("b")}
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-obsidian-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-obsidian-950 to-transparent" />
    </div>
  );
}

// ─── ROTATING HEADLINE ──────────────────────────────────────────────────────
function RotatingHeadline({ phase }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (phase !== "idle") return;
    const id = setInterval(() => setIdx((i) => (i + 1) % IDLE_HEADLINES.length), 4000);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === "spinning") {
    return (
      <motion.h1
        key="spinning"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter leading-[0.92] crimson-text animate-pulse"
        data-testid="hero-headline"
      >
        SPINNING NOW.
      </motion.h1>
    );
  }
  if (phase === "resolved") {
    return (
      <motion.h1
        key="resolved"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 14 }}
        className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter leading-[0.92] gold-text"
        data-testid="hero-headline"
      >
        WINNER PICKED.
      </motion.h1>
    );
  }

  const [line1, line2] = IDLE_HEADLINES[idx];
  return (
    <div className="relative min-h-[7rem] sm:min-h-[8.5rem] lg:min-h-[10rem]" data-testid="hero-headline">
      <AnimatePresence mode="wait">
        <motion.h1
          key={idx}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter leading-[1.02] pb-1"
        >
          <span className="block">{line1}</span>
          <span className="block gold-text">{line2}</span>
        </motion.h1>
      </AnimatePresence>
    </div>
  );
}

// ─── PRIZE BLOCK ────────────────────────────────────────────────────────────
function PrizeBlock({ stats, spinState, t, currency }) {
  const phase = spinState?.phase || "idle";

  let prizeLabel = "—";
  if (phase === "resolved" && spinState?.winner) {
    prizeLabel = formatPrize(spinState.winner);
  } else if (currency === "ROLLAT" && stats?.fixed_prize_rollat != null) {
    prizeLabel = formatAmount(stats.fixed_prize_rollat, "ROLLAT");
  } else if (stats?.fixed_prize_sol != null) {
    prizeLabel = formatAmount(stats.fixed_prize_sol, "SOL");
  } else if (stats?.current_pot_sol != null) {
    prizeLabel = fmtSol(stats.current_pot_sol);
  }

  const heading = phase === "resolved" ? "WINNER" : "TONIGHT'S PRIZE";

  return (
    <div className="my-10 text-center" data-testid="hero-prize">
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.4em] font-mono text-gold/60 mb-3">
        {heading}
      </div>
      {phase === "resolved" && spinState?.winner && (
        <div className="font-mono text-xs sm:text-sm text-white/60 mb-3 break-all">
          {truncWallet(spinState.winner.wallet)}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${phase}-${prizeLabel}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 180, damping: 16 }}
          className={`font-display font-black text-6xl sm:text-7xl lg:text-8xl tabular-nums tracking-tighter gold-text drop-shadow-[0_0_40px_rgba(255,215,0,0.25)] ${
            phase === "spinning" ? "animate-pulse" : ""
          }`}
        >
          {phase === "spinning" ? "—" : prizeLabel}
        </motion.div>
      </AnimatePresence>
      <div className="mt-4 font-mono text-xs sm:text-sm text-white/50 tabular-nums">
        {phase === "resolved" ? (
          <span>Round #{spinState?.winner?.round_number} · {spinState?.winner?.tickets}× tickets</span>
        ) : phase === "spinning" ? (
          <span className="inline-flex items-center gap-2">
            Selecting winner
            <span className="flex gap-1">
              {[0,1,2].map(i => (
                <span key={i} className="w-1 h-1 rounded-full bg-crimson animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
          </span>
        ) : (
          <span>
            {fmtCountdown(t)} · <span className="text-white/70">{stats?.total_qualified_wallets ?? "—"}</span> wallets in
          </span>
        )}
      </div>
    </div>
  );
}

// ─── CTAS ──────────────────────────────────────────────────────────────────
function CTAs() {
  return (
    <>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-4">
        <a
          href={ROLLAT_LINKS.pumpfun}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="hero-buy-btn"
        >
          <Button
            size="lg"
            className="w-full sm:w-auto bg-gold text-obsidian-950 hover:bg-gold-hover h-12 px-8 font-bold uppercase tracking-widest text-xs rounded-sm shadow-[0_0_32px_rgba(255,215,0,0.25)]"
          >
            Buy $ROLLAT
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </a>
        <Link to="/dashboard" data-testid="hero-qualify-btn">
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto h-12 px-8 font-bold uppercase tracking-widest text-xs rounded-sm border-gold/50 bg-transparent text-gold hover:bg-gold/10 hover:border-gold hover:text-gold"
          >
            Qualify Now
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/40">
        <span className="text-gold/50">also on</span>
        <a href={ROLLAT_LINKS.jupiter} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors">Jupiter</a>
        <span className="text-white/15">·</span>
        <a href={ROLLAT_LINKS.raydium} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors">Raydium</a>
        <span className="text-white/15">·</span>
        <a href={ROLLAT_LINKS.dexscreener} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors">DexScreener</a>
        <span className="text-white/15">·</span>
        <a href={ROLLAT_LINKS.solscan} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors">Solscan</a>
      </div>
    </>
  );
}

// ─── LAST WINNER STRIP + CELEBRATION ────────────────────────────────────────
function LastWinnerStrip({ lastWinner, spinState }) {
  const phase = spinState?.phase || "idle";
  const isCelebrating = phase === "resolved";
  const winner = isCelebrating && spinState?.winner ? spinState.winner : lastWinner;
  const canvasRef = useRef(null);

  useEffect(() => {
    if (isCelebrating) return launchConfetti(canvasRef.current, 4500);
  }, [isCelebrating]);

  if (!winner) return null;

  if (isCelebrating) {
    return (
      <>
        <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative mt-10 overflow-hidden rounded-sm border border-gold/40 bg-gradient-to-r from-gold/10 via-gold/5 to-transparent p-5 md:p-6"
          data-testid="hero-celebration"
        >
          <div className="absolute inset-0 opacity-20"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.4), transparent 70%)" }}
          />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-sm bg-gold/20 border border-gold/40 flex items-center justify-center">
                <Trophy className="w-5 h-5 text-gold" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-0.5">
                  Round #{winner.round_number} · Winner
                </div>
                <div className="font-mono text-white text-sm">{truncWallet(winner.wallet)}</div>
              </div>
            </div>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just witnessed ${formatPrize(winner)} drop in @Rollat_online's on-chain roulette 🎰 Round #${winner.round_number} · $ROLLAT`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sm:ml-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm bg-gold text-obsidian-950 hover:bg-gold-hover text-xs font-bold uppercase tracking-widest transition-colors"
            >
              Share Win on X
            </a>
          </div>
        </motion.div>
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mt-10 flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 rounded-sm border border-white/5 bg-obsidian-900/40 font-mono text-[11px]"
      data-testid="hero-last-winner"
    >
      <Trophy className="w-3.5 h-3.5 text-gold shrink-0" />
      <span className="text-white/40 uppercase tracking-[0.2em]">Last Winner</span>
      <span className="text-white">{truncWallet(winner.wallet)}</span>
      <span className="text-white/20">→</span>
      <span className="text-gold font-bold">{formatPrize(winner)}</span>
      <span className="text-white/30 hidden sm:inline">·</span>
      <span className="text-white/40 hidden sm:inline">Round #{winner.round_number}</span>
      {winner.payout_tx && (
        <a
          href={`https://solscan.io/tx/${winner.payout_tx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-white/45 hover:text-gold uppercase tracking-[0.2em] transition-colors"
          title="View payout tx on Solscan"
        >
          <ExternalLink className="w-3 h-3" /> Tx
        </a>
      )}
    </motion.div>
  );
}

// ─── CONTRACT BADGE ─────────────────────────────────────────────────────────
function ContractBadge() {
  const [copied, setCopied] = useState(false);
  function handleCopy(e) {
    e.preventDefault();
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(ROLLAT_MINT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <a
      href={ROLLAT_LINKS.solscan}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleCopy}
      title="Click to copy · right-click to open Solscan"
      className="inline-flex items-center gap-1.5 px-2 py-1 -my-1 rounded-sm border border-gold/30 hover:border-gold/60 bg-gold/5 hover:bg-gold/10 text-gold transition-colors"
      data-testid="hero-ca-badge"
    >
      <span className="text-[10px] font-mono normal-case tracking-normal">
        CA: <span className="tabular-nums">{truncateMint()}</span>
      </span>
      {copied ? <Check className="w-3 h-3 text-emerald_neon" /> : <Copy className="w-3 h-3 opacity-60" />}
      {copied && <span className="text-[10px] font-mono normal-case text-emerald_neon">Copied</span>}
    </a>
  );
}

// ─── HERO (composed) ────────────────────────────────────────────────────────
export default function Hero() {
  const { stats, spinState } = useSpinPhase() || {};
  const t = useCountdown(stats?.next_spin_at);
  const phase = spinState?.phase || "idle";
  const currency = stats?.prize_currency || "SOL";
  const [lastWinner] = useWinners(1);

  return (
    <section
      className="relative pt-24 pb-16 md:pt-28 md:pb-20 overflow-hidden grain felt-bg"
      data-testid="hero-section"
    >
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,215,0,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,215,0,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Top marquee — full width */}
      <div className="relative">
        <Marquee stats={stats} spinState={spinState} lastWinner={lastWinner} currency={currency} />
      </div>

      <div className="relative max-w-3xl mx-auto px-6 md:px-12 pt-14 md:pt-16">
        {/* Wordmark */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.4em] text-gold/70">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-flicker" />
            $ROLLAT · ON-CHAIN ROULETTE
          </span>
        </motion.div>

        {/* Rotating headline */}
        <div className="text-center">
          <RotatingHeadline phase={phase} />
        </div>

        {/* Subhead */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 text-base sm:text-lg text-white/55 max-w-2xl mx-auto text-center leading-relaxed"
          data-testid="hero-subheadline"
        >
          Hold ≥ 1,000,000 $ROLLAT for 24 continuous hours. Every snapshot you survive keeps you in the wheel. Switchboard VRF picks one wallet — prize drops straight in
          {currency === "ROLLAT" ? " as $ROLLAT" : " as SOL"}. No team votes. Just code.
        </motion.p>

        {/* Prize + countdown */}
        <PrizeBlock stats={stats} spinState={spinState} t={t} currency={currency} />

        {/* CTAs + secondary buy row */}
        <CTAs />

        {/* Last winner / celebration */}
        <LastWinnerStrip lastWinner={lastWinner} spinState={spinState} />

        {/* Trust bar */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[10px] text-white/40 font-mono uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-gold" />
            Switchboard VRF
          </div>
          <span className="text-white/20">·</span>
          <span>Solana</span>
          <span className="text-white/20">·</span>
          <ContractBadge />
          <span className="text-white/20">·</span>
          <span>Audited</span>
          <span className="text-white/20">·</span>
          <span>Fair Launch</span>
        </div>
      </div>
    </section>
  );
}
