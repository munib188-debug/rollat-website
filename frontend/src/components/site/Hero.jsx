import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { useCountdown, pad } from "@/lib/useCountdown";

export default function Hero() {
  const { stats, spinState } = useSpinPhase() || {};
  const t = useCountdown(stats?.next_spin_at);
  const phase = spinState?.phase || "idle";

  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden grain felt-bg" data-testid="hero-section">
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,215,0,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,215,0,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
        {/* Left content */}
        <div className="lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className={`inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-full border ${
              phase === "spinning" ? "border-crimson/50 bg-crimson/10" :
              phase === "resolved" ? "border-gold/50 bg-gold/10" :
              "border-gold/30 bg-gold/5"
            }`}
            data-testid="hero-badge"
          >
            <span className={`w-1.5 h-1.5 rounded-full animate-flicker ${
              phase === "spinning" ? "bg-crimson" :
              phase === "resolved" ? "bg-gold" :
              "bg-emerald_neon"
            }`} />
            <span className={`text-[11px] uppercase tracking-[0.2em] font-mono ${
              phase === "spinning" ? "text-crimson" :
              phase === "resolved" ? "text-gold" :
              "text-gold"
            }`}>
              {phase === "spinning" ? "Spinning Now · Live" :
               phase === "resolved" ? `Winner · Round #${spinState?.round_number || "—"}` :
               `Live · Round #${stats?.spins_completed ? stats.spins_completed + 1 : "—"}`}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter leading-[0.92]"
            data-testid="hero-headline"
          >
            <span className="block">HOLD THE BAG.</span>
            <span className="block gold-text">SPIN THE POT.</span>
            <span className="block text-white/50 text-3xl sm:text-4xl lg:text-5xl mt-3 font-bold">
              <span className="crimson-text">$ROLLAT</span> · the on-chain roulette.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-7 text-lg text-white/60 max-w-2xl leading-relaxed"
            data-testid="hero-subheadline"
          >
            Hold ≥ 1,000,000 $ROLLAT for 24 continuous hours. Every snapshot you survive
            keeps you in the wheel. Every 24 hours, Switchboard VRF picks one wallet —
            the entire pot drops straight into their connected wallet as SOL. No team
            votes. No bias. Just code.
          </motion.p>

          {/* Countdown / Spin Status */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-10 font-mono"
            data-testid="hero-countdown"
          >
            {phase === "spinning" ? (
              <div className="flex items-center gap-4">
                <div className="text-4xl sm:text-5xl font-black crimson-text animate-pulse tracking-tighter">SPINNING</div>
                <div className="flex gap-1">
                  {[0,1,2].map((i) => (
                    <div key={i} className="w-2 h-2 rounded-full bg-crimson animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            ) : phase === "resolved" ? (
              <div className="flex flex-col gap-1">
                <div className="text-[10px] tracking-[0.25em] text-white/40 uppercase">Winner</div>
                <div className="text-2xl sm:text-3xl font-black gold-text truncate max-w-xs">{spinState?.winner?.wallet || "—"}</div>
                <div className="text-lg font-bold text-gold">{spinState?.winner?.amount_sol ? `${spinState.winner.amount_sol} SOL` : ""}</div>
              </div>
            ) : (
              <div className="flex items-end gap-3">
                {[
                  { label: "DAYS", v: t.d },
                  { label: "HRS", v: t.h },
                  { label: "MIN", v: t.m },
                  { label: "SEC", v: t.s },
                ].map((c, i) => (
                  <div key={c.label} className="flex items-end gap-3">
                    <div className="text-center">
                      <div className="text-[10px] tracking-[0.25em] text-white/40 mb-1">{c.label}</div>
                      <div className="text-4xl sm:text-5xl font-black gold-text tabular-nums">{pad(c.v)}</div>
                    </div>
                    {i < 3 && <span className="text-3xl text-white/20 pb-1">:</span>}
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-10 flex flex-wrap gap-3"
          >
            <Link to="/dashboard">
              <Button
                size="lg"
                className="bg-gold text-obsidian-950 hover:bg-gold-hover h-12 px-7 font-bold uppercase tracking-widest text-xs rounded-sm shadow-[0_0_32px_rgba(255,215,0,0.25)]"
                data-testid="hero-qualify-btn"
              >
                Qualify Now
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="#mechanics">
              <Button
                size="lg"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/5 hover:text-white hover:border-white/40 h-12 px-7 font-medium uppercase tracking-widest text-xs rounded-sm"
                data-testid="hero-how-it-works-btn"
              >
                How it works
              </Button>
            </a>
          </motion.div>

          {/* Trust bar */}
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs text-white/40 font-mono uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-gold" />
              Switchboard VRF
            </div>
            <div>·</div>
            <div>Solana</div>
            <div>·</div>
            <div>Audited</div>
            <div>·</div>
            <div>Fair Launch</div>
          </div>
        </div>

        {/* Right - roulette wheel */}
        <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
          <RouletteVisual phase={phase} />
        </div>
      </div>
    </section>
  );
}

function RouletteVisual({ phase = "idle" }) {
  const spinDuration = phase === "spinning" ? 0.5 : phase === "resolved" ? 20 : 14;
  return (
    <div className="relative w-[320px] h-[320px] sm:w-[440px] sm:h-[440px]" data-testid="roulette-visual">
      {/* Outer glow ring */}
      <div className={`absolute inset-0 rounded-full blur-2xl opacity-60 transition-all duration-1000 ${
        phase === "spinning"
          ? "bg-gradient-to-br from-crimson/50 via-gold/30 to-crimson/20"
          : "bg-gradient-to-br from-gold/30 via-crimson/20 to-emerald_neon/10"
      }`} />
      {/* Tick marks ring */}
      <motion.div
        className="absolute inset-2 rounded-full border-2 border-gold/30"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, ease: "linear", repeat: Infinity }}
        style={{
          backgroundImage:
            "repeating-conic-gradient(from 0deg, rgba(255,215,0,0) 0deg 4deg, rgba(255,215,0,0.4) 4deg 5deg)",
          maskImage: "radial-gradient(circle, transparent 88%, black 89%)",
          WebkitMaskImage: "radial-gradient(circle, transparent 88%, black 89%)",
        }}
      />

      {/* Wheel */}
      <motion.div
        className="absolute inset-6 rounded-full roulette-wheel shadow-[0_30px_80px_rgba(0,0,0,0.6),inset_0_0_40px_rgba(0,0,0,0.5)]"
        animate={{ rotate: 360 }}
        transition={{ duration: spinDuration, ease: "linear", repeat: Infinity }}
      />

      {/* Pointer */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
        <div
          className="w-0 h-0"
          style={{
            borderLeft: "12px solid transparent",
            borderRight: "12px solid transparent",
            borderTop: "20px solid #FFD700",
            filter: "drop-shadow(0 0 8px rgba(255,215,0,0.6))",
          }}
        />
      </div>

      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-1">JACKPOT</div>
          <div className="font-display font-black text-2xl sm:text-3xl text-white">
            $ROLLAT
          </div>
        </div>
      </div>
    </div>
  );
}
