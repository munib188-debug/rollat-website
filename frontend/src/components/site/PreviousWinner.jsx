import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy } from "lucide-react";
import { useWinners } from "@/lib/api";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { launchConfetti } from "@/lib/confetti";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

const truncWallet = (w) =>
  w ? `${w.slice(0, 6)}...${w.slice(-4)}` : "—";

export default function PreviousWinner() {
  const [lastWinner] = useWinners(1);
  const { spinState } = useSpinPhase() || {};
  const phase = spinState?.phase || "idle";
  const isCelebrating = phase === "resolved";
  const canvasRef = useRef(null);
  const winner = isCelebrating && spinState?.winner ? spinState.winner : lastWinner;

  useEffect(() => {
    if (isCelebrating) {
      const cleanup = launchConfetti(canvasRef.current, 4000);
      return cleanup;
    }
  }, [isCelebrating]);

  if (!winner) return null;

  return (
    <section className="relative px-6 md:px-12 mb-6" data-testid="previous-winner-section">
      {/* Confetti canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-50"
        style={{ display: isCelebrating ? "block" : "none" }}
      />

      <div className="max-w-[1400px] mx-auto">
        <AnimatePresence mode="wait">
          {isCelebrating ? (
            <motion.div
              key="celebration"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4 }}
              className="relative overflow-hidden rounded-sm border border-gold/40 bg-gradient-to-r from-gold/10 via-gold/5 to-transparent p-6 md:p-8"
              data-testid="winner-celebration"
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
                      Round #{winner?.round_number || "—"} · Winner
                    </div>
                    <div className="font-mono text-white text-base">{truncWallet(winner?.wallet)}</div>
                  </div>
                </div>
                <div className="sm:ml-auto text-right">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                    className="font-display font-black text-3xl md:text-4xl gold-text tabular-nums"
                  >
                    {fmtSol(winner?.amount_sol)}
                  </motion.div>
                  <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-1">
                    {winner?.tickets}× tickets
                  </div>
                </div>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just won ${fmtSol(winner?.amount_sol)} in @Rollat_online's on-chain roulette 🎰 Round #${winner?.round_number} · $ROLLAT`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:ml-4 inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-white/20 hover:border-white/40 text-white/70 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors"
                >
                  Share Win
                </a>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="slim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-4 px-5 py-3 rounded-sm border border-white/5 bg-obsidian-900/40 text-sm font-mono"
              data-testid="previous-winner-bar"
            >
              <Trophy className="w-3.5 h-3.5 text-gold shrink-0" />
              <span className="text-white/40 text-[11px] uppercase tracking-[0.2em]">Last Winner</span>
              <span className="text-white">{truncWallet(winner?.wallet)}</span>
              <span className="text-white/20">→</span>
              <span className="text-gold font-bold">{fmtSol(winner?.amount_sol)}</span>
              <span className="text-white/30 hidden sm:inline">·</span>
              <span className="text-white/40 text-xs hidden sm:inline">Round #{winner?.round_number}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
